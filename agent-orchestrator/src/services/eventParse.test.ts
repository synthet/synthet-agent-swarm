import { describe, expect, it } from "vitest";
import { classifyOutcome, parseHarnessOutput } from "./eventParse.js";
import { finalizeResult } from "../runners/base.js";

const claudeResult = JSON.stringify({
  type: "result", subtype: "success", is_error: false, result: '{"verdict":"ok"}',
  session_id: "s-1", total_cost_usd: 0.04, usage: { input_tokens: 10 },
  permission_denials: [],
});

describe("parseHarnessOutput", () => {
  it("leaves stdout alone when no structured format was requested", () => {
    const parsed = parseHarnessOutput(undefined, '{"type":"result","result":"x"}');
    expect(parsed).toEqual({ text: '{"type":"result","result":"x"}', structured: false, denials: 0 });
  });

  it("reads a Claude json result", () => {
    const parsed = parseHarnessOutput("claude-json", claudeResult);
    expect(parsed).toMatchObject({
      text: '{"verdict":"ok"}', structured: true, sessionId: "s-1", costUsd: 0.04, denials: 0,
    });
    expect(parsed.failure).toBeUndefined();
  });

  it("reads the last result line of Claude stream-json and counts denials", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s-2" }),
      JSON.stringify({ type: "system", subtype: "permission_denied", tool: "Bash" }),
      JSON.stringify({ type: "result", is_error: false, result: "done", permission_denials: [{ tool_name: "Bash" }] }),
    ].join("\n");
    const parsed = parseHarnessOutput("claude-json", stdout);
    expect(parsed).toMatchObject({ text: "done", sessionId: "s-2", denials: 1 });
  });

  it("reports a Claude error result as a failure", () => {
    const parsed = parseHarnessOutput("claude-json", JSON.stringify({
      type: "result", subtype: "error_max_turns", is_error: true, result: "",
    }));
    expect(parsed.failure).toBe("error_max_turns");
  });

  it("reads Codex exec JSONL events", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t-9"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"i1","type":"reasoning","text":"thinking"}}',
      '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"final answer"}}',
      '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":7}}',
    ].join("\n");
    expect(parseHarnessOutput("codex-jsonl", stdout)).toMatchObject({
      text: "final answer", structured: true, sessionId: "t-9", usage: { input_tokens: 5, output_tokens: 7 },
    });
  });

  it("reports a failed Codex turn", () => {
    const parsed = parseHarnessOutput("codex-jsonl", '{"type":"turn.failed","error":{"message":"stream error"}}');
    expect(parsed.failure).toBe("stream error");
  });

  it("falls back to plain text when Codex printed no events", () => {
    expect(parseHarnessOutput("codex-jsonl", "plain reply")).toMatchObject({ text: "plain reply", structured: false });
  });

  it("reads an Antigravity json envelope", () => {
    const ok = parseHarnessOutput("agy-json", JSON.stringify({
      conversation_id: "c-1", status: "SUCCESS", response: "hi", error: null, num_turns: 1,
    }));
    expect(ok).toMatchObject({ text: "hi", sessionId: "c-1", structured: true });
    expect(ok.failure).toBeUndefined();
    const canceled = parseHarnessOutput("agy-json", JSON.stringify({
      conversation_id: "c-2", status: "CANCELED", response: "", error: "user canceled",
    }));
    expect(canceled.failure).toBe("user canceled");
  });

  it("reads a Cursor json result", () => {
    expect(parseHarnessOutput("cursor-json", JSON.stringify({
      type: "result", subtype: "success", is_error: false, result: "cursor says", session_id: "chat-1",
    }))).toMatchObject({ text: "cursor says", sessionId: "chat-1" });
  });
});

describe("classifyOutcome", () => {
  const parsed = (text: string, extra = {}) => ({ text, structured: true, denials: 0, ...extra });

  it.each([
    [{ exitCode: 0, stderr: "", parsed: parsed("x") }, "ok"],
    [{ exitCode: null, timedOut: true, stderr: "", parsed: parsed("") }, "timeout"],
    [{ exitCode: 1, stderr: "Error: authentication required", parsed: parsed("") }, "auth_required"],
    [{ exitCode: 1, stderr: "429 Too Many Requests", parsed: parsed("") }, "rate_limited"],
    [{ exitCode: 1, stderr: "boom", parsed: parsed("") }, "error"],
    [{ exitCode: 0, stderr: "", parsed: parsed("  ") }, "empty_output"],
    [{ exitCode: 0, stderr: "", parsed: parsed("x", { denials: 2 }) }, "permission_denied"],
    [{ exitCode: 0, stderr: "Tool run_command was soft-denied (request-review)", parsed: parsed("x") }, "soft_denied"],
    [{ exitCode: 0, stderr: "", parsed: parsed("x", { failure: "error_max_turns" }) }, "error"],
  ] as const)("classifies %j as %s", (input, outcome) => {
    expect(classifyOutcome(input)).toBe(outcome);
  });
});

describe("finalizeResult with a structured format", () => {
  it("returns the reply text, session id and cost, not the raw JSON", () => {
    const result = finalizeResult("claude", new Date().toISOString(), "claude -p", {
      exitCode: 0, stdout: claudeResult, stderr: "",
    }, "claude-json");
    expect(result).toMatchObject({
      ok: true, outcome: "ok", stdout: '{"verdict":"ok"}', sessionId: "s-1", costUsd: 0.04,
    });
  });

  it("fails an exit-0 run that printed nothing", () => {
    const result = finalizeResult("agy", new Date().toISOString(), "agy -p", {
      exitCode: 0, stdout: "", stderr: "",
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("empty_output");
    expect(result.error).toContain("no reply");
  });

  it("keeps a denied run's reply but reports the denial", () => {
    const result = finalizeResult("claude", new Date().toISOString(), "claude -p", {
      exitCode: 0,
      stdout: JSON.stringify({ type: "result", is_error: false, result: "partial", permission_denials: [{}] }),
      stderr: "",
    }, "claude-json");
    expect(result).toMatchObject({ ok: true, outcome: "permission_denied", denials: 1, stdout: "partial" });
  });
});
