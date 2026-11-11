import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../services/commandRunner.js";
import type { OrchestratorConfig } from "../types.js";
import { antMessagesArgv, antMessagesStdin, runAnt } from "./ant.js";

vi.mock("../services/commandRunner.js", async (original) => {
  const actual = await original<typeof import("../services/commandRunner.js")>();
  return { ...actual, runCommand: vi.fn() };
});

const config = {
  defaultTimeoutMs: 1000,
  maxTimeoutMs: 1000,
  allowWritesByDefault: false,
  allowedAgents: ["ant"],
  workspaceBoundary: ".",
  redactEnv: true,
  storeOutputs: false,
  storePrompts: false,
  detectionTimeoutMs: 1000,
} satisfies OrchestratorConfig;

describe("ant messages request", () => {
  it("puts the model on flags and the prompt on stdin", () => {
    expect(antMessagesArgv()).toEqual([
      "ant", "messages", "create", "--format", "json",
      "--model", "claude-opus-5-5", "--max-tokens", "4096",
    ]);
    expect(antMessagesArgv("claude-haiku-5-5", { maxTokens: 32, transform: "content.0.text" })).toEqual([
      "ant", "messages", "create", "--format", "json",
      "--model", "claude-haiku-5-5", "--max-tokens", "32",
      "--transform", "content.0.text", "--raw-output",
    ]);
    expect(JSON.parse(antMessagesStdin("Hello"))).toEqual({
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("reads the assistant text from the Messages response", async () => {
    vi.mocked(runCommand).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        type: "message",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: "Pong" }],
        usage: { input_tokens: 18, output_tokens: 5 },
      }),
      stderr: "",
      timedOut: false,
    });
    const result = await runAnt(
      { agent: "ant", task: "UNIQUE-ANT-TASK", workspaceRoot: process.cwd(), mode: "judge" },
      config,
    );
    const stdin = vi.mocked(runCommand).mock.calls[0]?.[0].stdin ?? "";
    expect(JSON.parse(stdin).messages[0].content).toContain("UNIQUE-ANT-TASK");
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("Pong");
    expect(result.commandPreview).not.toContain("UNIQUE-ANT-TASK");
  });
});
