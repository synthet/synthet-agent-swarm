import { describe, expect, it } from "vitest";
import { agreeVotes, extractLastJsonObject } from "./votes.js";

describe("extractLastJsonObject", () => {
  it("keeps an outer single-reply object instead of selecting its nested metadata", () => {
    expect(extractLastJsonObject('{"choice":"A","metadata":{"confidence":0.9}}')).toEqual({
      choice: "A", metadata: { confidence: 0.9 },
    });
  });

  it("does not salvage an inner row from a truncated reply", () => {
    expect(extractLastJsonObject('{"images":[{"id":"a","choice":"A"}')).toBeNull();
  });

  it("prefers the last object that has an images list", () => {
    const text = `note {"ok":true}\n{"images":[{"id":"a","choice":"A"}]}\nthanks`;
    expect(extractLastJsonObject(text)).toEqual({
      images: [{ id: "a", choice: "A" }],
    });
  });
});

describe("agreeVotes", () => {
  it.each([
    '{"images":[{"id":"unexpected","choice":"A"}]}',
    '{"images":[{"id":"a","choice":"A"}]}',
  ])("rejects replies that do not cover the exact panel manifest: %s", (text) => {
    const agreement = agreeVotes([{ agent: "codex", text }], ["a", "b"]);
    expect(agreement.parsedAgents).toEqual([]);
    expect(agreement.unparsedAgents).toEqual(["codex"]);
    expect(agreement.items).toEqual({});
  });

  it.each([
    ["A", "A", "B", "C"],
    ["A", "A", "B", "C", "D"],
  ])("requires a strict majority for %j", (...choices) => {
    const agreement = agreeVotes(choices.map((choice, index) => ({
      agent: `judge${index}`, text: JSON.stringify({ choice }),
    })));
    expect(agreement.items._reply.fields.choice).toMatchObject({ value: null, disputed: true });
  });

  it.each(['{"images":[]}', '{"images":[{"choice":"A"}]}', '{"images":[{"id":"a","choice":"A"},{"id":"a","choice":"B"}]}'])
    ("rejects empty, invalid or duplicate vote rows: %s", (text) => {
      const agreement = agreeVotes([{ agent: "codex", text }]);
      expect(agreement.parsedAgents).toEqual([]);
      expect(agreement.unparsedAgents).toEqual(["codex"]);
      expect(agreement.items).toEqual({});
    });

  it("supports labels and item ids that coincide with object prototype names", () => {
    const agreement = agreeVotes(["codex", "claude"].map(agent => ({
      agent, text: '{"images":[{"id":"__proto__","choice":"constructor"}]}',
    })));
    expect(agreement.items.__proto__.fields.choice).toMatchObject({
      value: "constructor", counts: { constructor: 2 }, disputed: false,
    });
    expect(Object.prototype).not.toHaveProperty("votes");
  });

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
