import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redaction.js";

describe("redactSecrets", () => {
  it("redacts OpenAI-style keys", () => {
    const input = "key=sk-abcdefghijklmnopqrstuvwxyz1234567890";
    expect(redactSecrets(input)).not.toContain("sk-abc");
    expect(redactSecrets(input)).toContain("[REDACTED");
  });

  it("redacts GitHub tokens", () => {
    const input = "token ghp_1234567890123456789012345678901234";
    expect(redactSecrets(input)).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer mysecrettokenvalue";
    expect(redactSecrets(input)).toContain("Bearer [REDACTED]");
  });
});
