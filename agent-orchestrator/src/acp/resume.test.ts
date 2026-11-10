import { describe, expect, it } from "vitest";
import { createLineQueue, runAcpTurn, type AcpIo } from "./client.js";

function peer(loadSession: boolean, methods: string[], promptSession = "old"): AcpIo {
  const queue = createLineQueue();
  const update = (text: string) => queue.push(JSON.stringify({
    jsonrpc: "2.0", method: "session/update",
    params: { sessionId: "old", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  }));
  return {
    write(line) {
      const message = JSON.parse(line);
      methods.push(message.method);
      if (message.method === "session/load") {
        expect(message.params).toEqual({ sessionId: "old", cwd: "/work", mcpServers: [] });
        update("replayed history ");
      }
      if (message.method === "session/prompt") {
        expect(message.params.sessionId).toBe(promptSession);
        update("fresh reply");
      }
      queue.push(JSON.stringify({ jsonrpc: "2.0", id: message.id, result:
        message.method === "initialize" ? { protocolVersion: 1, agentCapabilities: { loadSession } } :
        message.method === "session/new" ? { sessionId: "new" } :
        message.method === "session/prompt" ? { stopReason: "end_turn" } : {},
      }));
    },
    read: () => queue.read(),
    kill: () => queue.push(null),
  };
}

describe("ACP resume", () => {
  it("loads the session, drops the replayed history and reports the session id", async () => {
    const methods: string[] = [];
    const turn = await runAcpTurn(peer(true, methods), {
      cwd: "/work", prompt: "continue", timeoutMs: 1000, resumeSessionId: "old",
    });
    expect(methods).toEqual(["initialize", "session/load", "session/prompt"]);
    expect(turn.text).toBe("fresh reply");
    expect(turn.sessionId).toBe("old");
  });

  it("refuses to resume when the peer does not advertise loadSession", async () => {
    const methods: string[] = [];
    await expect(runAcpTurn(peer(false, methods), {
      cwd: "/work", prompt: "continue", timeoutMs: 1000, resumeSessionId: "old",
    })).rejects.toMatchObject({ code: "acp_protocol", message: expect.stringContaining("loadSession") });
    expect(methods).not.toContain("session/new");
  });

  it("reports the new session id on a fresh turn", async () => {
    const turn = await runAcpTurn(peer(true, [], "new"), { cwd: "/work", prompt: "hi", timeoutMs: 1000 });
    expect(turn.sessionId).toBe("new");
  });
});
