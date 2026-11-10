/**
 * Per-harness concurrency cap inside one server process. Each vendor rate-limits by account,
 * so concurrent MCP calls that pick the same harness queue here instead of racing the limit.
 */
const active = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();

export async function withHarnessSlot<T>(
  harness: string,
  limit: number,
  run: () => Promise<T>,
): Promise<T> {
  const cap = Math.max(1, Math.floor(limit));
  if ((active.get(harness) ?? 0) >= cap) {
    await new Promise<void>((resolve) => {
      const queue = waiting.get(harness) ?? [];
      queue.push(resolve);
      waiting.set(harness, queue);
    });
  } else {
    active.set(harness, (active.get(harness) ?? 0) + 1);
  }
  try {
    return await run();
  } finally {
    const next = waiting.get(harness)?.shift();
    // The slot passes straight to the next waiter; the active count stays the same.
    if (next) next();
    else active.set(harness, (active.get(harness) ?? 1) - 1);
  }
}
