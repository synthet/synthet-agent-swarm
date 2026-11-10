import { describe, expect, it } from "vitest";
import { createLineQueue, permissionAnswer, runAcpTurn, type AcpIo } from "./client.js";

const options = [
  { optionId: "yes", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always", kind: "allow_always" },
  { optionId: "no", name: "Reject", kind: "reject_once" },
];

describe("permissionAnswer", () => {
  const policy = { allowKinds: ["read", "search"] };

  it("cancels everything without a policy", () => {
    expect(permissionAnswer({ toolCall: { kind: "read" }, options }, undefined)).toEqual({
      outcome: { outcome: "cancelled" }, allowed: false,
    });
  });

  it("allows a listed kind once, never always", () => {
    expect(permissionAnswer({ toolCall: { kind: "read" }, options }, policy)).toEqual({
      outcome: { outcome: "selected", optionId: "yes" }, allowed: true,
    });
  });

  it.each(["edit", "execute", "delete", "fetch", undefined])("rejects kind %s once", (kind) => {
    expect(permissionAnswer({ toolCall: { kind }, options }, policy)).toEqual({
      outcome: { outcome: "selected", optionId: "no" }, allowed: false,
    });
  });

  it("cancels when the peer offers no reject option", () => {
    expect(permissionAnswer({ toolCall: { kind: "execute" }, options: [options[0]] }, policy).outcome)
      .toEqual({ outcome: "cancelled" });
  });
});

describe("runAcpTurn requests from the agent", () => {
  function peer(sent: Array<Record<string, any>>, withModes = true): AcpIo {
    const queue = createLineQueue();
    return {
      write(line) {
        const message = JSON.parse(line);
        sent.push(message);
        if (message.method === "session/prompt") {
          // Ask a blocking extension question and two permissions before finishing.
          queue.push(JSON.stringify({ jsonrpc: "2.0", id: 900, method: "cursor/ask_question", params: { question: "?" } }));
          queue.push(JSON.stringify({ jsonrpc: "2.0", id: 901, method: "session/request_permission",
            params: { toolCall: { kind: "read" }, options } }));
          queue.push(JSON.stringify({ jsonrpc: "2.0", id: 902, method: "session/request_permission",
            params: { toolCall: { kind: "edit" }, options } }));
        }
        if (message.method === undefined) return; // a reply to one of our requests above
        queue.push(JSON.stringify({ jsonrpc: "2.0", id: message.id, result:
          message.method === "initialize" ? { protocolVersion: 1 } :
          message.method === "session/new" ? { sessionId: "s1", modes: withModes ? { availableModes: [{ id: "agent" }, { id: "ask" }] } : {} } :
          message.method === "session/prompt" ? { stopReason: "end_turn" } : {},
        }));
      },
      read: () => queue.read(),
      kill: () => queue.push(null),
    };
  }

  it("answers unknown methods with -32601, applies the policy and sets the mode", async () => {
    const sent: Array<Record<string, any>> = [];
    const turn = await runAcpTurn(peer(sent), {
      cwd: "/w", prompt: "hi", timeoutMs: 2000, permissionPolicy: { allowKinds: ["read"] }, modeId: "ask",
    });
    expect(sent.find((m) => m.method === "session/set_mode")?.params).toEqual({ sessionId: "s1", modeId: "ask" });
    expect(sent.find((m) => m.id === 900)?.error?.code).toBe(-32601);
    expect(sent.find((m) => m.id === 901)?.result?.outcome).toEqual({ outcome: "selected", optionId: "yes" });
    expect(sent.find((m) => m.id === 902)?.result?.outcome).toEqual({ outcome: "selected", optionId: "no" });
    expect(turn.deniedPermissions).toBe(1);
  });

  it("fails before prompting when the requested mode is missing", async () => {
    const sent: Array<Record<string, any>> = [];
    await expect(runAcpTurn(peer(sent, false), { cwd: "/w", prompt: "hi", timeoutMs: 2000, modeId: "ask" }))
      .rejects.toMatchObject({ code: "acp_protocol", message: expect.stringContaining("ask mode") });
    expect(sent.some((m) => m.method === "session/prompt")).toBe(false);
  });
});
