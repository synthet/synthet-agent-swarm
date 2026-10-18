export interface AcpIo {
  write(line: string): void;
  read(): Promise<string | null>;
  kill(): void;
}

export interface AcpTurnResult {
  text: string;
  deniedPermissions: number;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export function createLineQueue(): {
  push(line: string | null): void;
  read(): Promise<string | null>;
} {
  const buffer: Array<string | null> = [];
  const waiters: Array<(line: string | null) => void> = [];
  return {
    push(line) {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else buffer.push(line);
    },
    read() {
      const next = buffer.shift();
      if (next !== undefined) return Promise.resolve(next);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

function textFromUpdate(update: unknown): string {
  if (!update || typeof update !== "object") return "";
  const record = update as {
    sessionUpdate?: string;
    content?: { text?: string } | Array<{ text?: string }>;
  };
  if (record.sessionUpdate !== "agent_message_chunk") return "";
  const content = record.content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return typeof content?.text === "string" ? content.text : "";
}

export async function runAcpTurn(
  io: AcpIo,
  input: { cwd: string; prompt: string; timeoutMs: number },
): Promise<AcpTurnResult> {
  let deniedPermissions = 0;
  let text = "";
  let nextId = 1;
  const pending = new Map<number, (message: RpcMessage) => void>();

  const reader = (async () => {
    for (;;) {
      const line = await io.read();
      if (line === null) return;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(trimmed) as RpcMessage;
      } catch {
        continue;
      }
      if (message.method === "session/request_permission" && message.id !== undefined) {
        deniedPermissions += 1;
        io.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { outcome: { outcome: "cancelled" } },
          }),
        );
        continue;
      }
      if (message.method === "session/update") {
        const params = message.params as { update?: unknown } | undefined;
        text += textFromUpdate(params?.update ?? params);
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve?.(message);
      }
    }
  })();

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    const result = new Promise((resolve, reject) => {
      pending.set(id, (message) => {
        if (message.error) {
          reject(new Error("acp_protocol"));
          return;
        }
        resolve(message.result);
      });
    });
    io.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return result;
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      io.kill();
      reject(new Error("timeout"));
    }, input.timeoutMs);
  });

  const turn = (async () => {
    await request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "synthet-agent-swarm", version: "0.1.0" },
    });
    const created = (await request("session/new", {
      cwd: input.cwd,
      mcpServers: [],
    })) as { sessionId?: string } | undefined;
    if (!created?.sessionId) throw new Error("acp_protocol");
    await request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: input.prompt }],
    });
    return { text, deniedPermissions };
  })();

  try {
    return await Promise.race([turn, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    io.kill();
    void reader;
  }
}
