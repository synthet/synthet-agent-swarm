export interface AcpIo {
  write(line: string): void;
  read(): Promise<string | null>;
  kill(): void;
  diagnostics?(): string;
}

export type AcpPhase = "initialize" | "authenticate" | "session/new" | "session/prompt";

export class AcpTurnError extends Error {
  constructor(
    public readonly code: "timeout" | "acp_protocol",
    public readonly phase: AcpPhase,
    message: string,
    public readonly text: string,
    public readonly deniedPermissions: number,
  ) {
    super(message);
    this.name = "AcpTurnError";
  }
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
  let closed = false;
  return {
    push(line) {
      if (closed) return;
      if (line === null) {
        closed = true;
        for (const waiter of waiters.splice(0)) waiter(null);
        return;
      }
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else buffer.push(line);
    },
    read() {
      const next = buffer.shift();
      if (next !== undefined) return Promise.resolve(next);
      if (closed) return Promise.resolve(null);
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
  input: { cwd: string; prompt: string; timeoutMs: number; authMethodIds?: string[] },
): Promise<AcpTurnResult> {
  let deniedPermissions = 0;
  let text = "";
  let nextId = 1;
  let phase: AcpPhase = "initialize";
  const pending = new Map<number, (message: RpcMessage) => void>();

  const failure = (code: "timeout" | "acp_protocol", message: string) =>
    new AcpTurnError(code, phase, message, text, deniedPermissions);
  let rejectPeer!: (error: Error) => void;
  const peerFailure = new Promise<never>((_, reject) => { rejectPeer = reject; });

  const reader = (async () => {
    try {
      for (;;) {
        const line = await io.read();
        if (line === null) {
          rejectPeer(failure("acp_protocol", `ACP peer closed during ${phase}.`));
          return;
        }
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
    } catch {
      rejectPeer(failure("acp_protocol", `ACP read failed during ${phase}.`));
    }
  })();

  function request(method: AcpPhase, params: unknown): Promise<unknown> {
    phase = method;
    const id = nextId++;
    const result = new Promise((resolve, reject) => {
      pending.set(id, (message) => {
        if (message.error) {
          reject(failure("acp_protocol", `ACP ${method} returned a protocol error.`));
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
      reject(failure("timeout", `Command timed out after ${input.timeoutMs}ms during ACP ${phase}.`));
      io.kill();
    }, input.timeoutMs);
  });

  const turn = (async () => {
    const initialized = await request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "synthet-agent-swarm", version: "0.1.1" },
    }) as { authMethods?: Array<{ id: string }> } | undefined;
    if (input.authMethodIds && initialized?.authMethods?.length) {
      const methodId = input.authMethodIds.find(id =>
        initialized.authMethods!.some(method => method.id === id),
      );
      if (!methodId) {
        throw failure("acp_protocol", "ACP initialize advertised no supported headless authentication method. Check the harness login.");
      }
      await request("authenticate", { methodId, _meta: { headless: true } });
    }
    const created = (await request("session/new", {
      cwd: input.cwd,
      mcpServers: [],
    })) as { sessionId?: string } | undefined;
    if (!created?.sessionId) throw failure("acp_protocol", "ACP session/new returned no sessionId.");
    const response = await request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: input.prompt }],
    }) as { stopReason?: string } | undefined;
    if (response?.stopReason !== "end_turn") {
      throw failure("acp_protocol", "ACP session/prompt did not complete with end_turn.");
    }
    return { text, deniedPermissions };
  })();

  try {
    return await Promise.race([turn, timeout, peerFailure]);
  } finally {
    if (timer) clearTimeout(timer);
    io.kill();
    void reader;
  }
}
