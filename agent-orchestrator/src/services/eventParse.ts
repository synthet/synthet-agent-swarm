/**
 * Parse the structured output a headless harness prints, and classify how the run ended.
 *
 * Exit codes alone are not proof of success: Claude reports denials in its result, Antigravity
 * soft-denies with exit 0, and an agy child without a TTY can print nothing at all.
 */

export type OutputFormat = "claude-json" | "cursor-json" | "codex-jsonl" | "agy-json";

export type RunOutcome =
  | "ok"
  | "permission_denied"
  | "soft_denied"
  | "auth_required"
  | "rate_limited"
  | "timeout"
  | "empty_output"
  | "error";

export interface ParsedOutput {
  /** Final reply text. The raw stdout when nothing structured was found. */
  text: string;
  /** True when a structured payload of the expected format was found. */
  structured: boolean;
  sessionId?: string;
  costUsd?: number;
  usage?: unknown;
  /** Permission requests the harness reported as denied. */
  denials: number;
  /** Error message the payload itself reported. */
  failure?: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every JSON object in stdout: the whole text, or one per line. */
export function jsonObjects(stdout: string): Json[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const whole: unknown = JSON.parse(trimmed);
    if (isObject(whole)) return [whole];
    if (Array.isArray(whole)) return whole.filter(isObject);
  } catch {
    // Not one document; fall through to JSON lines.
  }
  const rows: Json[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (isObject(value)) rows.push(value);
    } catch {
      // A partial or non-JSON line is skipped.
    }
  }
  return rows;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Claude `--output-format json|stream-json` and Cursor `--output-format json|stream-json`. */
function parseResultEvents(rows: Json[], stdout: string): ParsedOutput {
  const result = [...rows].reverse().find((row) => row.type === "result");
  const deniedEvents = rows.filter(
    (row) => row.type === "system" && row.subtype === "permission_denied",
  ).length;
  if (!result) return { text: stdout, structured: false, denials: deniedEvents };
  const denials = Array.isArray(result.permission_denials)
    ? result.permission_denials.length
    : 0;
  const text = str(result.result) ?? "";
  return {
    text,
    structured: true,
    sessionId: str(result.session_id) ?? str(rows.find((row) => str(row.session_id))?.session_id),
    costUsd: num(result.total_cost_usd),
    usage: result.usage,
    denials: Math.max(denials, deniedEvents),
    failure: result.is_error === true
      ? text || str(result.subtype) || "The harness reported an error result."
      : undefined,
  };
}

/** Codex `exec --json`: thread.started, item.completed, turn.completed, turn.failed, error. */
function parseCodexEvents(rows: Json[], stdout: string): ParsedOutput {
  if (!rows.some((row) => typeof row.type === "string" && /^(thread|turn|item)\.|^error$/.test(row.type))) {
    return { text: stdout, structured: false, denials: 0 };
  }
  let text = "";
  let sessionId: string | undefined;
  let usage: unknown;
  let failure: string | undefined;
  for (const row of rows) {
    if (row.type === "thread.started") sessionId = str(row.thread_id) ?? sessionId;
    if (row.type === "item.completed" && isObject(row.item) && row.item.type === "agent_message") {
      text = str(row.item.text) ?? text;
    }
    if (row.type === "turn.completed") usage = row.usage;
    if (row.type === "turn.failed") {
      failure = (isObject(row.error) ? str(row.error.message) : undefined) ?? "Codex turn failed.";
    }
    if (row.type === "error") failure = str(row.message) ?? "Codex reported an error.";
  }
  return { text, structured: true, sessionId, usage, denials: 0, failure };
}

/** Antigravity `--output-format json`: one envelope with conversation_id, status, response, error. */
function parseAgyEnvelope(rows: Json[], stdout: string): ParsedOutput {
  const envelope = [...rows].reverse().find((row) => "status" in row && ("response" in row || "conversation_id" in row));
  if (!envelope) return { text: stdout, structured: false, denials: 0 };
  const status = str(envelope.status);
  const error = isObject(envelope.error) ? str(envelope.error.message) : str(envelope.error);
  return {
    text: str(envelope.response) ?? "",
    structured: true,
    sessionId: str(envelope.conversation_id),
    usage: envelope.usage,
    denials: 0,
    failure: status && status !== "SUCCESS" ? error ?? `Antigravity status ${status}.` : undefined,
  };
}

export function parseHarnessOutput(format: OutputFormat | undefined, stdout: string): ParsedOutput {
  if (!format) return { text: stdout, structured: false, denials: 0 };
  const rows = jsonObjects(stdout);
  switch (format) {
    case "claude-json":
    case "cursor-json":
      return parseResultEvents(rows, stdout);
    case "codex-jsonl":
      return parseCodexEvents(rows, stdout);
    case "agy-json":
      return parseAgyEnvelope(rows, stdout);
  }
}

const AUTH_RE = /authentication required|not (?:logged|signed) in|please (?:log|sign) in|invalid api key|unauthori[sz]ed|\b401\b/i;
const RATE_RE = /rate.?limit|too many requests|\b429\b|overloaded|quota exceeded/i;
/** Antigravity prints a stderr notice when a tool needing approval is soft-denied and the run goes on. */
const SOFT_DENY_RE = /soft-?denied|requires? (?:review|approval)|was not approved|permission (?:was )?denied/i;

export function classifyOutcome(input: {
  exitCode: number | null;
  timedOut?: boolean;
  error?: string;
  stderr: string;
  parsed: ParsedOutput;
}): RunOutcome {
  if (input.timedOut) return "timeout";
  const failed = input.exitCode !== 0 || Boolean(input.error) || Boolean(input.parsed.failure);
  if (failed) {
    const evidence = [input.error, input.parsed.failure, input.stderr].filter(Boolean).join("\n");
    if (AUTH_RE.test(evidence)) return "auth_required";
    if (RATE_RE.test(evidence)) return "rate_limited";
    return "error";
  }
  if (input.parsed.text.trim() === "") return "empty_output";
  if (input.parsed.denials > 0) return "permission_denied";
  if (SOFT_DENY_RE.test(input.stderr)) return "soft_denied";
  return "ok";
}
