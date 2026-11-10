import { readFileSync } from "node:fs";
import { getWorkspaceRoot, loadConfig } from "./config.js";
import { invalidArguments, swarmRunInputSchema, swarmRunRequest } from "./tools/swarmRun.js";
import { swarmSearch } from "./tools/swarmSearch.js";
import {
  runSubagentInputSchema,
  runSubagentTool,
} from "./tools/runSubagent.js";
import {
  runJudgeSwarmInputSchema,
  runJudgeSwarmTool,
} from "./tools/runJudgeSwarm.js";
import {
  swarmDecideInputSchema,
  swarmDecideTool,
} from "./tools/swarmDecide.js";

function printUsage(): void {
  console.error(`Usage:
  synthet-agent-swarm detect
  synthet-agent-swarm decide --state <json> --questions <json> [--harnesses <h1,h2>] [--model <model>] [--timeout-ms <ms>] [--dry-run]
  synthet-agent-swarm run --agent <codex|antigravity|claude> --task "<task>" [options]
  synthet-agent-swarm run --request <file.json|->
  synthet-agent-swarm swarm --task "<task>" [options]

detect prints the swarm_search catalog.
run --request reads one swarm_run request as JSON from a file, or from stdin with -, so no prompt
text is on the command line. It prints one JSON object: the swarm_run response plus "reply", the
reply text when exactly one harness ran and succeeded. Exit 0 ok, 1 run failed, 2 invalid request.
decide runs a zero-tool Jev-compatible structured decision over lightweight flash models.

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

The swarm command is the legacy judge wrapper. New callers use the MCP tools swarm_search, swarm_run, and swarm_decide.
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
      case "--request":
        out.request = next;
        i++;
        break;
      case "--harnesses":
        out.harnesses = next?.split(",").map((h) => h.trim()).filter(Boolean);
        i++;
        break;
      case "--model":
        out.model = next;
        i++;
        break;
      case "--state":
        try {
          out.state = next ? JSON.parse(next) : {};
        } catch {
          out.state = next;
        }
        i++;
        break;
      case "--questions":
        try {
          out.questions = next ? JSON.parse(next) : {};
        } catch {
          out.questions = null;
        }
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
    const result = await swarmSearch();
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (command === "decide") {
    const raw = parseRunArgs(rest);
    if (!raw.harnesses && raw.agent && typeof raw.agent === "string") {
      raw.harnesses = [raw.agent];
    }
    const parsed = swarmDecideInputSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(JSON.stringify({ ok: false, error: parsed.error.flatten() }, null, 2));
      return 1;
    }
    const response = await swarmDecideTool(parsed.data);
    console.log(JSON.stringify(response, null, 2));
    return response.ok ? 0 : 1;
  }

  if (command === "run") {
    const raw = parseRunArgs(rest);
    if (typeof raw.request === "string") return runRequest(raw.request);
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function runRequest(source: string): Promise<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(source === "-" ? await readStdin() : readFileSync(source, "utf8"));
  } catch (err) {
    console.log(JSON.stringify(invalidArguments({ request: err instanceof Error ? err.message : String(err) })));
    return 2;
  }
  const parsed = swarmRunInputSchema.safeParse(raw);
  if (!parsed.success) {
    console.log(JSON.stringify(invalidArguments(parsed.error.flatten())));
    return 2;
  }
  const response = await swarmRunRequest(parsed.data);
  console.log(JSON.stringify(response));
  return response.ok ? 0 : 1;
}

export function getCliWorkspaceRoot(): string {
  return getWorkspaceRoot();
}

export function getCliConfig() {
  return loadConfig(getWorkspaceRoot());
}
