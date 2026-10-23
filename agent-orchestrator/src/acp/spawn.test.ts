import { describe, expect, it } from "vitest";
import { spawnAcpProcess } from "./spawn.js";

describe("spawnAcpProcess", () => {
  it("preserves stderr and the final protocol line without a trailing newline", async () => {
    const io = spawnAcpProcess([
      process.execPath, "-e",
      'process.stderr.write("MCP startup failed\\n"); process.stdout.write(JSON.stringify({id:1,result:{}})); process.exitCode=7;',
    ], process.cwd());
    try {
      expect(await io.read()).toBe('{"id":1,"result":{}}');
      expect(await io.read()).toBeNull();
      expect(await io.read()).toBeNull();
      expect(io.diagnostics?.()).toContain("MCP startup failed");
      expect(io.diagnostics?.()).toContain("code 7");
    } finally {
      io.kill();
    }
  });

  it("records launch failures without waiting for a prompt timeout", async () => {
    const io = spawnAcpProcess(["synthet-test-nonexistent-acp-peer-001"], process.cwd());
    try {
      expect(await io.read()).toBeNull();
      expect(io.diagnostics?.()).toMatch(/process error.*ENOENT/);
    } finally {
      io.kill();
    }
  });
});
