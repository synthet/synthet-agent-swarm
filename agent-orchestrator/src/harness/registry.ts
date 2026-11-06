import type { HarnessId, SwarmTransport } from "../types.js";

export type TransportChoice = "auto" | SwarmTransport;

export interface HarnessSpec {
  id: HarnessId;
  title: string;
  command: string;
  /** One-shot CLI argv prefix. Null when this slice has no CLI transport. */
  cliArgv: string[] | null;
  /** ACP argv. Null until help text shows an ACP mode. */
  acpArgv: string[] | null;
  notes: string[];
  /** Left out of default runs. It still runs when named. */
  retired?: boolean;
}

export interface HarnessObservation {
  spec: HarnessSpec;
  cliOnPath: boolean;
  cliHelp: string;
  version: string | null;
  acpOnPath: boolean;
  /** Set when help text shows an ACP mode the spec did not list. */
  acpArgv: string[] | null;
  modelFlag: "--model" | null;
  transports: SwarmTransport[];
  available: boolean;
  binaryFound: boolean;
  cliMode: "exec" | "print" | "prompt" | null;
  promptFlag?: "-p" | "--prompt" | "--print";
  supportsCd: boolean;
  notes: string[];
}

export interface SearchRow {
  id: HarnessId;
  title: string;
  command: string;
  available: boolean;
  transports: SwarmTransport[];
  modelFlag: "--model" | null;
  notes: string[];
}

export interface SwarmError {
  code:
    | "unknown_harness"
    | "harness_unavailable"
    | "model_unsupported"
    | "model_chain_invalid"
    | "transport_unavailable"
    | "path_rejected"
    | "timeout"
    | "acp_protocol"
    | "invalid_arguments"
    | "execution_failed"
    | "artifact_storage";
  message: string;
  details: Record<string, unknown>;
  retryable: boolean;
  next_steps: string[];
}

export interface RunnablePlan {
  id: HarnessId;
  transport: SwarmTransport;
  model?: string;
  /** Ordered fallback chain. `model` is its first entry. */
  models?: string[];
  observation: HarnessObservation;
}

export interface SkippedPlan {
  id: string;
  error: SwarmError;
}

export type PlanStep =
  | { kind: "run"; plan: RunnablePlan }
  | { kind: "skip"; skip: SkippedPlan };

export type SwarmPlan =
  | { ok: true; steps: PlanStep[] }
  | { ok: false; error: SwarmError };

export const HARNESS_SPECS: HarnessSpec[] = [
  {
    id: "codex",
    title: "Codex",
    command: "codex exec",
    cliArgv: ["codex", "exec"],
    acpArgv: ["codex-acp"],
    notes: [
      "Read-only sandbox on the one-shot CLI. ACP is used only when codex-acp is already on PATH.",
    ],
  },
  {
    id: "claude",
    title: "Claude Code",
    command: "claude -p",
    cliArgv: ["claude", "-p"],
    acpArgv: ["claude-code-acp"],
    notes: [
      "Print mode uses claude -p. ACP uses claude-code-acp when that command is already on PATH.",
    ],
  },
  {
    id: "agy",
    title: "Antigravity",
    command: "agy -p",
    cliArgv: ["agy", "-p"],
    acpArgv: null,
    notes: [
      "Antigravity replaced the Gemini CLI. A search for gemini also returns this row.",
    ],
  },
  {
    id: "cursor",
    title: "Cursor agent",
    command: "agent acp",
    cliArgv: ["agent"],
    acpArgv: ["agent", "acp"],
    notes: [
      "Token agent selects this harness. ACP is agent acp. Print mode is used only when help shows -p, --print, or --prompt.",
    ],
  },
  {
    id: "gemini",
    title: "Gemini CLI",
    command: "gemini -p",
    cliArgv: ["gemini", "-p"],
    acpArgv: null,
    retired: true,
    notes: [
      "Retired: Google refuses personal sign-in for this CLI. Use agy, which offers Gemini models through --model.",
      "Separate from agy. Available only when the gemini binary has a print mode.",
    ],
  },
  {
    id: "grok",
    title: "Grok",
    command: "grok agent stdio",
    cliArgv: null,
    acpArgv: ["grok", "agent", "stdio"],
    notes: ["ACP only in this slice: grok agent stdio. There is no one-shot CLI runner."],
  },
];

const HARNESS_IDS = new Set<string>(HARNESS_SPECS.map((spec) => spec.id));

export function helpHasFlag(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,])${escaped}(?=$|[\\s,=\\[<])`, "i").test(help);
}

export function modelFlagFromHelp(help: string): "--model" | null {
  return helpHasFlag(help, "--model") ? "--model" : null;
}

export function cliTransportFromHelp(id: HarnessId, help: string): boolean {
  if (id === "grok") return false;
  if (id === "codex") return /\bexec\b/.test(help);
  return promptFlagFromHelp(help) !== undefined;
}

export function promptFlagFromHelp(help: string): "-p" | "--prompt" | "--print" | undefined {
  if (helpHasFlag(help, "-p")) return "-p";
  if (helpHasFlag(help, "--prompt")) return "--prompt";
  if (helpHasFlag(help, "--print")) return "--print";
  return undefined;
}

export function classifyObservation(input: {
  spec: HarnessSpec;
  cliOnPath: boolean;
  cliHelp: string;
  version: string | null;
  acpOnPath: boolean;
}): HarnessObservation {
  const help = input.cliHelp ?? "";
  // Grok also ships agent.exe. On Windows it can shadow Cursor's agent.cmd.
  // A known conflicting identity must never count as a second provider vote.
  const identityConflict = input.spec.id === "cursor" &&
    /(?:^\s*Grok Build TUI\b|^\s*Usage:\s+grok\b)/im.test(help);
  const modelFlag = modelFlagFromHelp(help);
  const promptFlag = promptFlagFromHelp(help);
  const cli =
    input.spec.cliArgv !== null &&
    !identityConflict &&
    input.cliOnPath &&
    cliTransportFromHelp(input.spec.id, help);

  let acpArgv = input.spec.acpArgv;
  let acp = Boolean(!identityConflict && input.acpOnPath && acpArgv);
  if (
    !acp &&
    (input.spec.id === "agy" || input.spec.id === "gemini") &&
    input.cliOnPath &&
    /\bacp\b/i.test(help)
  ) {
    const bin = input.spec.cliArgv?.[0] ?? input.spec.id;
    // Gemini exposes a flag, not an "acp" positional prompt/subcommand.
    const geminiFlag = /(?:^|\s)--acp(?=[\s,=]|$)/m.test(help) ? "--acp"
      : /(?:^|\s)--experimental-acp(?=[\s,=]|$)/m.test(help) ? "--experimental-acp" : null;
    if (input.spec.id !== "gemini" || geminiFlag) {
      acp = true;
      acpArgv = [bin, input.spec.id === "gemini" ? geminiFlag! : "acp"];
    }
  }

  const transports: SwarmTransport[] = [];
  if (cli) transports.push("cli");
  if (acp) transports.push("acp");

  let cliMode: HarnessObservation["cliMode"] = null;
  if (cli && input.spec.id === "codex") cliMode = "exec";
  else if (cli && input.spec.id === "agy") cliMode = "prompt";
  else if (cli) cliMode = "print";

  const notes = [...input.spec.notes];
  if (identityConflict) {
    notes.push("The agent command identifies itself as Grok, not Cursor. Both transports are disabled; correct PATH/launcher identity before running Cursor.");
  }
  if (!input.cliOnPath && input.spec.cliArgv) {
    notes.push("CLI command was not found on PATH.");
  }
  if (input.spec.acpArgv && !input.acpOnPath) {
    notes.push("ACP command was not found on PATH. Adapters are not downloaded.");
  }
  if (input.cliOnPath && input.spec.cliArgv && !cli && input.spec.id !== "grok") {
    notes.push("Help text did not show a one-shot exec or print mode.");
  }

  return {
    spec: input.spec,
    cliOnPath: input.cliOnPath,
    cliHelp: help.slice(0, 4000),
    version: input.version,
    acpOnPath: input.acpOnPath,
    acpArgv,
    modelFlag,
    transports,
    available: transports.length > 0,
    binaryFound: Boolean(
      (input.cliOnPath && (help.length > 0 || input.version)) ||
        (input.acpOnPath && acpArgv),
    ),
    cliMode,
    promptFlag,
    supportsCd: helpHasFlag(help, "--cd"),
    notes,
  };
}

export function searchRows(observations: HarnessObservation[]): SearchRow[] {
  return observations.map((observation) => ({
    id: observation.spec.id,
    title: observation.spec.title,
    command: observation.spec.command,
    available: observation.available,
    transports: observation.transports,
    modelFlag: observation.modelFlag,
    notes: observation.notes,
  }));
}

const QUERY_ALIASES: Record<string, HarnessId[]> = {
  gemini: ["gemini", "agy"],
  antigravity: ["agy"],
  agent: ["cursor"],
};

export function searchHarnesses(
  observations: HarnessObservation[],
  query?: string,
): SearchRow[] {
  const rows = searchRows(observations);
  const q = query?.trim().toLowerCase();
  if (!q) return rows;
  const aliased = new Set(QUERY_ALIASES[q] ?? []);
  return rows.filter((row) => {
    if (aliased.has(row.id)) return true;
    const haystack = [
      row.id,
      row.title,
      row.command,
      ...row.transports,
      ...row.notes,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function resolveHarnessId(
  token: string,
  observations: HarnessObservation[],
): HarnessId | null {
  const trimmed = token.trim();
  const byId = new Map(observations.map((row) => [row.spec.id, row]));
  if (trimmed === "antigravity") return byId.has("agy") ? "agy" : null;
  if (trimmed === "agent") return byId.has("cursor") ? "cursor" : null;
  if (trimmed === "gemini") {
    const gemini = byId.get("gemini");
    if (gemini?.available) return "gemini";
    return byId.has("agy") ? "agy" : null;
  }
  if (HARNESS_IDS.has(trimmed) && byId.has(trimmed as HarnessId)) {
    return trimmed as HarnessId;
  }
  return null;
}

export function selectTransport(
  observation: HarnessObservation,
  requested: TransportChoice,
): SwarmTransport | null {
  if (requested === "auto") {
    if (observation.transports.includes("cli")) return "cli";
    if (observation.transports.includes("acp")) return "acp";
    return null;
  }
  return observation.transports.includes(requested) ? requested : null;
}

export function applyModel(
  argv: string[],
  harness: string,
  model?: string,
): string[] {
  if (!model || argv.length === 0) return argv;
  if (harness === "codex") {
    const next = [...argv];
    next.splice(Math.max(next.length - 1, 1), 0, "--model", model);
    return next;
  }
  return [argv[0], "--model", model, ...argv.slice(1)];
}

export function swarmError(
  code: SwarmError["code"],
  message: string,
  details: Record<string, unknown> = {},
  nextSteps: string[] = [],
  retryable = false,
): SwarmError {
  return {
    code,
    message,
    details,
    retryable,
    next_steps: nextSteps,
  };
}

export function planSwarmRun(input: {
  observations: HarnessObservation[];
  harnesses?: string[];
  model?: string;
  modelChains?: Record<string, string[]>;
  transport?: TransportChoice;
  allowed: string[];
}): SwarmPlan {
  const transport = input.transport ?? "auto";
  const chainEntries = Object.entries(input.modelChains ?? {});
  if (input.model && chainEntries.length > 0) {
    return {
      ok: false,
      error: swarmError(
        "model_chain_invalid",
        "Pass model or modelChains, not both.",
        {},
        ["Use modelChains with a one-item list to pin a single harness."],
      ),
    };
  }
  const chains = new Map<string, string[]>();
  for (const [token, models] of chainEntries) {
    const id = resolveHarnessId(token, input.observations);
    if (id === null || chains.has(id)) {
      return {
        ok: false,
        error: swarmError(
          "model_chain_invalid",
          `modelChains key ${token} is unknown or repeated.`,
          { key: token },
          ["Use one key per harness id from swarm_search."],
        ),
      };
    }
    chains.set(id, models);
  }
  const allowed = new Set(
    input.allowed.map((agent) =>
      agent === "antigravity" || agent === "agy"
        ? "agy"
        : agent === "agent"
          ? "cursor"
          : agent,
    ),
  );
  const byId = new Map(input.observations.map((row) => [row.spec.id, row]));

  let tokens = input.harnesses;
  if (!tokens || tokens.length === 0) {
    tokens = input.observations
      .filter((row) => allowed.has(row.spec.id) && !row.spec.retired && selectTransport(row, transport))
      .map((row) => row.spec.id);
    if (tokens.length === 0) {
      return {
        ok: false,
        error: swarmError(
          "harness_unavailable",
          "No allowed harness is available for the requested transport.",
          { transport },
          ["Call swarm_search and pass harnesses that list the transport you need."],
        ),
      };
    }
  }

  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
  }

  const unknown = unique.filter(
    (token) => resolveHarnessId(token, input.observations) === null,
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      error: swarmError(
        "unknown_harness",
        `Unknown harness: ${unknown.join(", ")}.`,
        { harnesses: unknown },
        searchHarnesses(input.observations).map((row) => `${row.id}: ${row.title}`),
      ),
    };
  }

  const resolved = unique.map((token) => ({
    token,
    id: resolveHarnessId(token, input.observations) as HarnessId,
  }));

  const steps: PlanStep[] = [];
  const runnable: RunnablePlan[] = [];
  const seen = new Set<string>();
  for (const item of resolved) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const observation = byId.get(item.id);
    if (!observation || !allowed.has(item.id) || !observation.available) {
      steps.push({
        kind: "skip",
        skip: {
          id: item.id,
          error: swarmError(
            "harness_unavailable",
            !observation || !allowed.has(item.id)
              ? `${item.id} is not allowed by config.`
              : `${item.id} is not available.`,
            { harness: item.id },
            ["Call swarm_search to see which harnesses are available."],
          ),
        },
      });
      continue;
    }
    const chain = chains.get(item.id);
    const pinned = chain?.[0] ?? input.model;
    // Cursor's --model changes its saved default; only an ACP session pins a model for one run.
    const chosen = transport === "auto" && pinned && item.id === "cursor" && observation.transports.includes("acp")
      ? "acp"
      : selectTransport(observation, transport);
    if (!chosen) {
      steps.push({
        kind: "skip",
        skip: {
          id: item.id,
          error: swarmError(
            "transport_unavailable",
            `${item.id} has no ${transport} transport.`,
            { harness: item.id, transport, transports: observation.transports },
            [
              observation.transports.length
                ? `Use transport ${observation.transports.join(" or ")} for ${item.id}.`
                : `Omit ${item.id} or install its command.`,
            ],
          ),
        },
      });
      continue;
    }
    const plan: RunnablePlan = {
      id: item.id,
      transport: chosen,
      observation,
      model: pinned,
      models: chain,
    };
    runnable.push(plan);
    steps.push({ kind: "run", plan });
  }

  const unmatched = [...chains.keys()].filter((id) => !seen.has(id));
  if (unmatched.length > 0) {
    return {
      ok: false,
      error: swarmError(
        "model_chain_invalid",
        `modelChains names harnesses outside this run: ${unmatched.join(", ")}.`,
        { harnesses: unmatched },
        ["Add them to harnesses, or remove their chains."],
      ),
    };
  }

  if (input.model || chains.size > 0) {
    // An ACP session pins its model through session config, not a command flag.
    const missing = runnable.filter(
      (plan) => plan.model && plan.transport === "cli" && plan.observation.modelFlag === null,
    );
    if (missing.length > 0) {
      const supported = input.observations
        .filter((row) => row.modelFlag)
        .map((row) => row.spec.id);
      return {
        ok: false,
        error: swarmError(
          "model_unsupported",
          `These harnesses do not advertise a model flag: ${missing.map((plan) => plan.id).join(", ")}.`,
          { model: input.model, harnesses: missing.map((plan) => plan.id) },
          supported,
        ),
      };
    }
  }

  return { ok: true, steps };
}
