import { describe, expect, it, vi } from "vitest";
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
  it("authenticates with an advertised headless method before creating a Grok session", async () => {
    const queue = createLineQueue();
    const methods: string[] = [];
    const io: AcpIo = {
      write(line) {
        const message = JSON.parse(line);
        methods.push(message.method);
        if (message.method === "authenticate") {
          expect(message.params).toEqual({ methodId: "cached_token", _meta: { headless: true } });
        }
        queue.push(JSON.stringify({ id: message.id, result:
          message.method === "initialize" ? { protocolVersion: 1, authMethods: [{ id: "cached_token", name: "Sign in" }] } :
          message.method === "session/new" ? { sessionId: "s1" } :
          message.method === "session/prompt" ? { stopReason: "end_turn" } : {},
        }));
      },
      read: () => queue.read(), kill: () => queue.push(null),
    };
    await runAcpTurn(io, { cwd: "/work", prompt: "say ok", timeoutMs: 1000, authMethodIds: ["cached_token"] });
    expect(methods).toEqual(["initialize", "authenticate", "session/new", "session/prompt"]);
  });

  it.each(["initialize", "authenticate", "session/new", "session/prompt"])(
    "identifies the stalled %s phase within the total timeout", async (stalled) => {
      vi.useFakeTimers();
      try {
        const queue = createLineQueue();
        const io: AcpIo = {
          write(line) {
            const message = JSON.parse(line);
            if (message.method === stalled) return;
            queue.push(JSON.stringify({ jsonrpc: "2.0", id: message.id,
              result: message.method === "initialize"
                ? { protocolVersion: 1, authMethods: [{ id: "cached_token" }] }
                : { sessionId: "s1" },
            }));
          },
          read: () => queue.read(),
          kill: () => queue.push(null),
        };
        const turn = runAcpTurn(io, {
          cwd: "/work", prompt: "say ok", timeoutMs: 120000, authMethodIds: ["cached_token"],
        });
        const outcome = turn.catch(error => error);
        await vi.advanceTimersByTimeAsync(120000);
        expect(await outcome).toMatchObject({
          code: "timeout", phase: stalled,
          message: expect.stringContaining(stalled),
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("reports peer EOF immediately instead of waiting for the whole timeout", async () => {
    const io: AcpIo = { write() {}, read: async () => null, kill() {} };
    const turn = runAcpTurn(io, { cwd: "/work", prompt: "say ok", timeoutMs: 50 });
    await expect(turn).rejects.toMatchObject({ code: "acp_protocol", phase: "initialize" });
  });

  it("treats a cancelled prompt as failure even if it streamed valid JSON", async () => {
    const queue = createLineQueue();
    const io: AcpIo = {
      write(line) {
        const message = JSON.parse(line);
        if (message.method === "session/prompt") {
          queue.push(JSON.stringify({ method: "session/update", params: { update: {
            sessionUpdate: "agent_message_chunk", content: { text: '{"choice":"A"}' },
          } } }));
        }
        queue.push(JSON.stringify({ id: message.id, result:
          message.method === "initialize" ? { protocolVersion: 1 } :
          message.method === "session/new" ? { sessionId: "s1" } : { stopReason: "cancelled" },
        }));
      },
      read: () => queue.read(), kill: () => queue.push(null),
    };
    await expect(runAcpTurn(io, { cwd: "/work", prompt: "vote", timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: "acp_protocol", phase: "session/prompt", text: '{"choice":"A"}' });
  });

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
