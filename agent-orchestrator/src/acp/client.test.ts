import { describe, expect, it } from "vitest";
import { createLineQueue, runAcpTurn, type AcpIo } from "./client.js";

function linked(): { client: AcpIo; serverRead: () => Promise<string | null>; serverWrite: (line: string) => void } {
  const toClient = createLineQueue();
  const toServer = createLineQueue();
  const client: AcpIo = {
    write(line) {
      toServer.push(line);
    },
    read() {
      return toClient.read();
    },
    kill() {
      toClient.push(null);
      toServer.push(null);
    },
  };
  return {
    client,
    serverRead: () => toServer.read(),
    serverWrite: (line) => toClient.push(line),
  };
}

describe("runAcpTurn", () => {
  it("collects prompt text and denies permission requests", async () => {
    const { client, serverRead, serverWrite } = linked();
    let promptText = "";

    const peer = (async () => {
      for (;;) {
        const line = await serverRead();
        if (line === null) return;
        const message = JSON.parse(line) as {
          id?: number;
          method?: string;
          params?: { prompt?: Array<{ text?: string }> };
          result?: { outcome?: { outcome?: string } };
        };
        if (message.method === "initialize") {
          serverWrite(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } }));
        } else if (message.method === "session/new") {
          serverWrite(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } }));
        } else if (message.method === "session/prompt") {
          promptText = message.params?.prompt?.[0]?.text ?? "";
          serverWrite(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 99,
              method: "session/request_permission",
              params: { sessionId: "s1", toolCall: { title: "edit file" } },
            }),
          );
        } else if (message.id === 99) {
          expect(message.result?.outcome?.outcome).toBe("cancelled");
          serverWrite(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "hello" },
                },
              },
            }),
          );
          serverWrite(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              result: { stopReason: "end_turn" },
            }),
          );
        }
      }
    })();

    const result = await runAcpTurn(client, {
      cwd: "/work",
      prompt: "grade the evidence",
      timeoutMs: 2000,
    });

    expect(promptText).toBe("grade the evidence");
    expect(result.text).toBe("hello");
    expect(result.deniedPermissions).toBe(1);
    await peer;
  });
});
