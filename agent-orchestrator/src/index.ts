#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runCli } from "./cli.js";
import { registerSwarmTools } from "./tools/register.js";

async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "synthet-agent-swarm",
    version: "0.1.0",
  });
  registerSwarmTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "mcp") {
    await startMcpServer();
    return;
  }

  const code = await runCli(args);
  process.exitCode = code;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
