import { getWorkspaceRoot, loadConfig } from "./config.js";
import { detectSubagents } from "./tools/detectSubagents.js";
import {
  runSubagentInputSchema,
  runSubagentTool,
} from "./tools/runSubagent.js";
import {
  runJudgeSwarmInputSchema,
  runJudgeSwarmTool,
} from "./tools/runJudgeSwarm.js";

function printUsage(): void {
  console.error(`Usage:
  synthet-agent-swarm detect
  synthet-agent-swarm run --agent <codex|antigravity|claude> --task "<task>" [options]
  synthet-agent-swarm swarm --task "<task>" [options]

Options for run:
  --files <path>[,<path>...]
  --mode <review|implement|explain|test|tie-breaker|judge>
  --timeout-ms <number>
  --dry-run
  --extra-context <text>

Options for swarm:
  --files <path>[,<path>...]
  --agents <codex|antigravity|claude>[,...]
  --timeout-ms <number>
  --dry-run
  --extra-context <text>
`);
}

function parseRunArgs(args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--agent":
        out.agent = next;
        i++;
        break;
      case "--task":
        out.task = next;
        i++;
        break;
      case "--files":
        out.files = next?.split(",").map((f) => f.trim()).filter(Boolean);
        i++;
        break;
      case "--mode":
        out.mode = next;
        i++;
        break;
      case "--timeout-ms":
        out.timeoutMs = Number(next);
        i++;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--extra-context":
        out.extraContext = next;
        i++;
        break;
      case "--allow-writes":
        out.allowWrites = true;
        break;
      case "--agents":
        out.agents = next?.split(",").map((agent) => agent.trim()).filter(Boolean);
        i++;
        break;
      default:
        break;
    }
  }
  return out;
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return command ? 0 : 1;
  }

  if (command === "detect") {
    const result = await detectSubagents();
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (command === "run") {
    const raw = parseRunArgs(rest);
    const parsed = runSubagentInputSchema.safeParse({
      ...raw,
      allowWrites: raw.allowWrites ?? false,
    });
    if (!parsed.success) {
      console.error(JSON.stringify({ error: parsed.error.flatten() }, null, 2));
      return 1;
    }
    const response = await runSubagentTool(parsed.data);
    console.log(JSON.stringify(response, null, 2));
    return response.ok ? 0 : 1;
  }

  if (command === "swarm") {
    const raw = parseRunArgs(rest);
    const parsed = runJudgeSwarmInputSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(JSON.stringify({ error: parsed.error.flatten() }, null, 2));
      return 1;
    }
    const response = await runJudgeSwarmTool(parsed.data);
    console.log(JSON.stringify(response, null, 2));
    return response.ok ? 0 : 1;
  }

  if (command === "mcp") {
    return 0;
  }

  printUsage();
  return 1;
}

export function getCliWorkspaceRoot(): string {
  return getWorkspaceRoot();
}

export function getCliConfig() {
  return loadConfig(getWorkspaceRoot());
}
