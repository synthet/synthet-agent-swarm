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

function fakePeer(reply: (message: { method: string; params?: Record<string, unknown> }) => object) {
  const queue = createLineQueue();
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const io: AcpIo = {
    write(line) {
      const message = JSON.parse(line);
      calls.push({ method: message.method, params: message.params });
      queue.push(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...reply(message) }));
    },
    read: () => queue.read(),
    kill: () => queue.push(null),
  };
  return { io, calls };
}

const modelOptions = (currentValue: string) => [{
  id: "model", category: "model", currentValue,
  options: [{ value: "grok-4.7[fast=true]" }, { value: "composer-2.5[fast=true]" }],
}];

function modelPeer(overrides: Record<string, object> = {}) {
  let current = "grok-4.7[fast=true]";
  return fakePeer(({ method, params }) => {
    if (overrides[method]) return overrides[method];
    if (method === "session/new") {
      return { result: { sessionId: "s1", models: { currentModelId: current }, configOptions: modelOptions(current) } };
    }
    if (method === "session/set_config_option") {
      current = params?.value as string;
      return { result: { configOptions: modelOptions(current) } };
    }
    if (method === "session/prompt") return { result: { stopReason: "end_turn" } };
    return { result: { protocolVersion: 1 } };
  });
}

const turnInput = { cwd: "/work", prompt: "say ok", timeoutMs: 1000 };

describe("runAcpTurn errors and models", () => {
  it("keeps the peer's error code and message", async () => {
    const { io } = modelPeer({
      "session/new": { error: { code: -32000, message: "This client is no longer supported." } },
    });
    await expect(runAcpTurn(io, turnInput)).rejects.toMatchObject({
      phase: "session/new",
      message: expect.stringContaining("-32000: This client is no longer supported."),
    });
  });

  it("reports the session's model when none was requested", async () => {
    const { io, calls } = modelPeer();
    const result = await runAcpTurn(io, turnInput);
    expect(result.reportedModel).toBe("grok-4.7[fast=true]");
    expect(calls.map(call => call.method)).not.toContain("session/set_config_option");
  });

  it("pins the model by base name and restores the previous default after the turn", async () => {
    const { io, calls } = modelPeer();
    const result = await runAcpTurn(io, { ...turnInput, model: "composer-2.5" });
    expect(result.reportedModel).toBe("composer-2.5[fast=true]");
    expect(calls.map(call => call.method)).toEqual([
      "initialize", "session/new", "session/set_config_option", "session/prompt", "session/set_config_option",
    ]);
    expect(calls[2].params).toMatchObject({ sessionId: "s1", configId: "model", value: "composer-2.5[fast=true]" });
    expect(calls[4].params).toMatchObject({ sessionId: "s1", configId: "model", value: "grok-4.7[fast=true]" });
    expect(result.modelRestoreFailed).toBeUndefined();
  });

  it("changes nothing when the requested model is already current", async () => {
    const { io, calls } = modelPeer();
    const result = await runAcpTurn(io, { ...turnInput, model: "grok-4.7" });
    expect(result.reportedModel).toBe("grok-4.7[fast=true]");
    expect(calls.map(call => call.method)).not.toContain("session/set_config_option");
  });

  it("refuses a model the session does not offer, before any prompt", async () => {
    const { io, calls } = modelPeer();
    await expect(runAcpTurn(io, { ...turnInput, model: "gpt-9" })).rejects.toMatchObject({
      message: expect.stringContaining("gpt-9"),
    });
    expect(calls.map(call => call.method)).not.toContain("session/prompt");
  });

  it("refuses to run when the session has no model option", async () => {
    const { io, calls } = modelPeer({ "session/new": { result: { sessionId: "s1" } } });
    await expect(runAcpTurn(io, { ...turnInput, model: "composer-2.5" })).rejects.toMatchObject({
      message: expect.stringContaining("no model option"),
    });
    expect(calls.map(call => call.method)).not.toContain("session/prompt");
  });

  it("refuses to run when the peer does not confirm the model, and still restores", async () => {
    const { io, calls } = modelPeer({
      "session/set_config_option": { result: { configOptions: modelOptions("grok-4.7[fast=true]") } },
    });
    await expect(runAcpTurn(io, { ...turnInput, model: "composer-2.5" })).rejects.toMatchObject({
      message: expect.stringContaining("composer-2.5[fast=true]"),
    });
    const methods = calls.map(call => call.method);
    expect(methods).not.toContain("session/prompt");
    expect(calls.at(-1)?.params).toMatchObject({ value: "grok-4.7[fast=true]" });
  });

  it("restores the default after a failed prompt", async () => {
    const { io, calls } = modelPeer({ "session/prompt": { error: { code: -32603, message: "boom" } } });
    await expect(runAcpTurn(io, { ...turnInput, model: "composer-2.5" })).rejects.toMatchObject({
      phase: "session/prompt",
    });
    expect(calls.at(-1)).toMatchObject({
      method: "session/set_config_option", params: { value: "grok-4.7[fast=true]" },
    });
  });

  it("flags a failed restore", async () => {
    let sets = 0;
    const { io } = fakePeer(({ method, params }) => {
      if (method === "session/new") {
        return { result: { sessionId: "s1", configOptions: modelOptions("grok-4.7[fast=true]") } };
      }
      if (method === "session/set_config_option") {
        sets += 1;
        return sets === 1
          ? { result: { configOptions: modelOptions(params?.value as string) } }
          : { error: { code: -32603, message: "nope" } };
      }
      if (method === "session/prompt") return { result: { stopReason: "end_turn" } };
      return { result: { protocolVersion: 1 } };
    });
    const result = await runAcpTurn(io, { ...turnInput, model: "composer-2.5" });
    expect(result.modelRestoreFailed).toBe(true);
  });
});
