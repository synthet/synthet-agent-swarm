import { z } from "zod";
import { getWorkspaceRoot, loadConfig } from "../config.js";
import {
  analyzeAgainstHuman,
  buildJevState,
  panelBuild,
  panelSwarmInput,
  type PanelAnalysis,
  type PanelBuild,
} from "../services/panel.js";
import {
  relativeOutputPath,
  storePanelSummary,
} from "../services/resultStore.js";
import { emptyAgreement, type SwarmAgreement } from "../services/votes.js";
import type { RunSubagentMcpResponse } from "../types.js";
import {
  runJudgeSwarmTool,
  type JudgeSwarmResponse,
} from "./runJudgeSwarm.js";

const itemId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);

export const runJudgePanelInputSchema = z
  .object({
    task: z.string().min(1).max(8000),
    items: z
      .array(
        z.object({
          id: itemId,
          files: z.array(z.string().min(1)).min(1).max(20),
        }),
      )
      .min(1)
      .max(20),
    agents: z
      .array(z.enum(["codex", "antigravity", "claude"]))
      .min(1)
      .max(3)
      .optional(),
    timeoutMs: z.number().int().positive().optional(),
    dryRun: z.boolean().optional().default(false),
    blind: z.boolean().optional().default(true),
    extraContext: z.string().max(4000).optional(),
    rubric: z.string().min(1).max(200).optional(),
    humanLabels: z
      .record(
        itemId,
        z.record(z.string().min(1).max(80), z.string().min(1).max(500)),
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.blind && value.extraContext) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extraContext"],
        message:
          "Blind panels reject extraContext so labels cannot reach the judges.",
      });
    }
    const ids = value.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Item ids must be unique.",
      });
    }
    const files = new Set(
      value.items.flatMap((item) =>
        item.files.map((file) => file.replace(/\\/g, "/")),
      ),
    );
    if (files.size > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "A panel accepts at most 20 evidence files.",
      });
    }
  });

export interface JudgePanelResponse {
  ok: boolean;
  dryRun: boolean;
  outputDir?: string;
  stages: {
    build: PanelBuild;
    run: {
      ok: boolean;
      outputDir?: string;
      judges: RunSubagentMcpResponse[];
      error?: string;
    };
    votes: SwarmAgreement;
    jev: {
      called: false;
      dryRunRequired: true;
      state: ReturnType<typeof buildJevState>;
      note: string;
    };
    analyze: PanelAnalysis;
    rules: { applied: false; note: string };
  };
  note: string;
  error?: string;
}

const JEV_NOTE =
  "Jev is not called. The calling project may send this text state to jev_system_one after a dry-run. One narrow question per decision. Image bytes stay out of that call.";

const RULES_NOTE =
  "Keep, cull, delete, and rating writes stay in the calling project. This tool does not mutate files or databases.";

type PanelInput = z.infer<typeof runJudgePanelInputSchema>;

export function assembleJudgePanel(args: {
  build: PanelBuild;
  swarm: JudgeSwarmResponse;
  dryRun: boolean;
  humanLabels?: PanelInput["humanLabels"];
}): JudgePanelResponse {
  const agreement = args.swarm.agreement;
  const hasLabels = Boolean(
    args.humanLabels && Object.keys(args.humanLabels).length > 0,
  );
  const analyze: PanelAnalysis = args.dryRun
    ? { skipped: true, reason: "Dry run collects no votes." }
    : hasLabels
      ? analyzeAgainstHuman(agreement, args.humanLabels ?? {})
      : {
          skipped: true,
          reason:
            "No human labels were provided. Panel votes are not ground truth.",
        };

  return {
    ok: args.swarm.ok,
    dryRun: args.dryRun,
    stages: {
      build: args.build,
      run: {
        ok: args.swarm.ok,
        outputDir: args.swarm.outputDir,
        judges: args.swarm.judges,
        error: args.swarm.error,
      },
      votes: agreement,
      jev: {
        called: false,
        dryRunRequired: true,
        state: args.dryRun ? { items: [] } : buildJevState(agreement),
        note: JEV_NOTE,
      },
      analyze,
      rules: { applied: false, note: RULES_NOTE },
    },
    note: agreement.note,
    error: args.swarm.error,
  };
}

function failedPanel(
  build: PanelBuild,
  dryRun: boolean,
  error: string,
): JudgePanelResponse {
  const swarm: JudgeSwarmResponse = {
    ok: false,
    dryRun,
    judges: [],
    agreement: emptyAgreement("The panel did not run."),
    note: "Agent-panel labels are not ground truth.",
    error,
  };
  return assembleJudgePanel({ build, swarm, dryRun });
}

export async function runJudgePanelTool(
  input: PanelInput,
): Promise<JudgePanelResponse> {
  const dryRun = input.dryRun ?? false;
  const blind = input.blind ?? true;
  const build = panelBuild(input.items, blind, input.rubric);

  let swarmInput;
  try {
    swarmInput = panelSwarmInput({ ...input, blind, dryRun });
  } catch (err) {
    return failedPanel(
      build,
      dryRun,
      err instanceof Error ? err.message : String(err),
    );
  }

  const swarm = await runJudgeSwarmTool(swarmInput);
  const assembled = assembleJudgePanel({
    build,
    swarm,
    dryRun,
    humanLabels: input.humanLabels,
  });

  const workspaceRoot = getWorkspaceRoot();
  const stored = storePanelSummary(
    workspaceRoot,
    input.task,
    assembled,
    loadConfig(workspaceRoot),
  );
  if (stored) {
    assembled.outputDir = relativeOutputPath(workspaceRoot, stored);
  }
  return assembled;
}
