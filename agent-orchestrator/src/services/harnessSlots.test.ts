import { describe, expect, it } from "vitest";
import { withHarnessSlot } from "./harnessSlots.js";

describe("withHarnessSlot", () => {
  it("runs at most the limit at once per harness and lets other harnesses through", async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const job = (name: string, harness: string) =>
      withHarnessSlot(harness, 2, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push(name);
        running -= 1;
        return name;
      });
    const results = await Promise.all([
      job("a", "claude"), job("b", "claude"), job("c", "claude"), job("x", "codex"),
    ]);
    expect(results).toEqual(["a", "b", "c", "x"]);
    expect(peak).toBe(3);
    expect(order.indexOf("c")).toBeGreaterThan(order.indexOf("a"));
  });

  it("releases the slot when the run throws", async () => {
    await expect(withHarnessSlot("agy", 1, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withHarnessSlot("agy", 1, async () => "next")).resolves.toBe("next");
  });
});
