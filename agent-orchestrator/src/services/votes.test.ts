import { describe, expect, it } from "vitest";
import { agreeVotes, extractLastJsonObject } from "./votes.js";

describe("extractLastJsonObject", () => {
  it("prefers the last object that has an images list", () => {
    const text = `note {"ok":true}\n{"images":[{"id":"a","choice":"A"}]}\nthanks`;
    expect(extractLastJsonObject(text)).toEqual({
      images: [{ id: "a", choice: "A" }],
    });
  });
});

describe("agreeVotes", () => {
  it("agrees when two of three judges share a value and leaves a tie disputed", () => {
    const reply = (choice: string, own: string) =>
      JSON.stringify({
        images: [{ id: "a1", own_id: own, choice }],
      });
    const agreement = agreeVotes([
      { agent: "codex", text: reply("A", "heron") },
      { agent: "antigravity", text: `preamble\n${reply("A", "egret")}` },
      { agent: "claude", text: reply("B", "heron") },
    ]);

    expect(agreement.parsedAgents).toEqual(["codex", "antigravity", "claude"]);
    expect(agreement.items.a1.fields.choice).toMatchObject({
      value: "A",
      disputed: false,
      answered: 3,
    });
    expect(agreement.items.a1.fields.own_id).toMatchObject({
      value: "heron",
      disputed: false,
    });
  });

  it("does not treat a single parsed vote as agreement", () => {
    const agreement = agreeVotes([
      {
        agent: "codex",
        text: '{"images":[{"id":"a1","choice":"A"}]}',
      },
      { agent: "claude", text: "I think A" },
    ]);

    expect(agreement.unparsedAgents).toEqual(["claude"]);
    expect(agreement.items.a1.fields.choice.value).toBeNull();
    expect(agreement.items.a1.fields.choice.disputed).toBe(true);
  });

  it("marks an even split disputed", () => {
    const agreement = agreeVotes([
      { agent: "codex", text: '{"scene":"landscape"}' },
      { agent: "antigravity", text: '{"scene":"plants_flowers"}' },
    ]);

    expect(agreement.items._reply.fields.scene).toMatchObject({
      value: null,
      disputed: true,
      counts: { landscape: 1, plants_flowers: 1 },
    });
  });
});
