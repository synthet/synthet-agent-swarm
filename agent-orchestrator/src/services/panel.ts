import type { SwarmAgreement } from "./votes.js";

export interface PanelItem {
  id: string;
  files: string[];
}

export interface PanelBuild {
  blind: boolean;
  rubric?: string;
  items: PanelItem[];
  files: string[];
  note: string;
}

export interface JevPanelState {
  items: Array<{
    id: string;
    votes: Record<string, Record<string, string>>;
    agreed: Record<string, string | null>;
    disputed: string[];
  }>;
}

export interface VoteComparison {
  compared: number;
  exactMatches: number;
  kappa: number | null;
}

export interface PanelFieldComparison extends VoteComparison {
  unresolved: number;
}

export interface PanelDisagreement {
  id: string;
  field: string;
  human: string;
  panel: string | null;
  disputed: boolean;
}

export type PanelAnalysis =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      perJudge: Record<string, Record<string, VoteComparison>>;
      panel: Record<string, PanelFieldComparison>;
      disagreements: PanelDisagreement[];
      truncated: boolean;
      note: string;
    };

const HUMAN_NOTE =
  "Human labels stay separate from panel votes. This tool does not overwrite them.";

const DISAGREEMENT_CAP = 50;

export function panelEvidenceFiles(items: PanelItem[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const item of items) {
    for (const file of item.files) {
      const key = file.replace(/\\/g, "/");
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }
  return files;
}

export function panelTask(task: string, ids: string[]): string {
  const suffix = `\n\nItem ids: ${ids.join(", ")}\nReturn only one JSON object with an images array. Each row uses one of these ids.`;
  const combined = `${task.trim()}${suffix}`;
  if (combined.length > 8000) {
    throw new Error(
      "Task plus the item-id contract exceeds 8000 characters. Shorten the task.",
    );
  }
  return combined;
}

export function panelSwarmInput(input: {
  task: string;
  items: PanelItem[];
  agents?: Array<"codex" | "antigravity" | "claude">;
  timeoutMs?: number;
  dryRun?: boolean;
  blind?: boolean;
  extraContext?: string;
}): {
  task: string;
  files: string[];
  agents?: Array<"codex" | "antigravity" | "claude">;
  timeoutMs?: number;
  dryRun: boolean;
  extraContext?: string;
} {
  const blind = input.blind !== false;
  return {
    task: panelTask(
      input.task,
      input.items.map((item) => item.id),
    ),
    files: panelEvidenceFiles(input.items),
    agents: input.agents,
    timeoutMs: input.timeoutMs,
    dryRun: input.dryRun ?? false,
    extraContext: blind ? undefined : input.extraContext,
  };
}

export function cohenKappa(pairs: Array<[string, string]>): number | null {
  if (pairs.length < 2) return null;
  const total = pairs.length;
  let matches = 0;
  const leftCounts: Record<string, number> = {};
  const rightCounts: Record<string, number> = {};
  for (const [left, right] of pairs) {
    if (left === right) matches += 1;
    leftCounts[left] = (leftCounts[left] ?? 0) + 1;
    rightCounts[right] = (rightCounts[right] ?? 0) + 1;
  }
  const observed = matches / total;
  let expected = 0;
  const labels = new Set([
    ...Object.keys(leftCounts),
    ...Object.keys(rightCounts),
  ]);
  for (const label of labels) {
    expected +=
      ((leftCounts[label] ?? 0) / total) * ((rightCounts[label] ?? 0) / total);
  }
  if (expected === 1) return observed === 1 ? 1 : 0;
  return (observed - expected) / (1 - expected);
}

export function buildJevState(agreement: SwarmAgreement): JevPanelState {
  return {
    items: Object.entries(agreement.items).map(([id, item]) => {
      const agreed: Record<string, string | null> = {};
      const disputed: string[] = [];
      for (const [field, aggregate] of Object.entries(item.fields)) {
        agreed[field] = aggregate.value;
        if (aggregate.disputed) disputed.push(field);
      }
      return { id, votes: item.votes, agreed, disputed };
    }),
  };
}

export function analyzeAgainstHuman(
  agreement: SwarmAgreement,
  humanLabels: Record<string, Record<string, string>>,
): Exclude<PanelAnalysis, { skipped: true }> {
  const judgePairs: Record<string, Record<string, Array<[string, string]>>> =
    {};
  const panelPairs: Record<string, Array<[string, string]>> = {};
  const unresolved: Record<string, number> = {};
  const disagreements: PanelDisagreement[] = [];
  let hidden = 0;

  for (const [id, labels] of Object.entries(humanLabels)) {
    const item = agreement.items[id];
    for (const [field, human] of Object.entries(labels)) {
      const aggregate = item?.fields[field];
      const resolved = Boolean(aggregate && !aggregate.disputed && aggregate.value);
      if (!resolved) {
        unresolved[field] = (unresolved[field] ?? 0) + 1;
        hidden += pushDisagreement(disagreements, {
          id,
          field,
          human,
          panel: null,
          disputed: true,
        });
      } else {
        const value = aggregate!.value as string;
        (panelPairs[field] ??= []).push([value, human]);
        if (value !== human) {
          hidden += pushDisagreement(disagreements, {
            id,
            field,
            human,
            panel: value,
            disputed: false,
          });
        }
      }
      if (!item) continue;
      for (const [agent, vote] of Object.entries(item.votes)) {
        const value = vote[field];
        if (!value) continue;
        ((judgePairs[agent] ??= {})[field] ??= []).push([value, human]);
      }
    }
  }

  const perJudge: Record<string, Record<string, VoteComparison>> = {};
  for (const [agent, fields] of Object.entries(judgePairs)) {
    perJudge[agent] = {};
    for (const [field, pairs] of Object.entries(fields)) {
      perJudge[agent][field] = summarize(pairs);
    }
  }

  const panel: Record<string, PanelFieldComparison> = {};
  const fields = new Set([
    ...Object.keys(panelPairs),
    ...Object.keys(unresolved),
  ]);
  for (const field of fields) {
    const summary = summarize(panelPairs[field] ?? []);
    panel[field] = {
      ...summary,
      unresolved: unresolved[field] ?? 0,
    };
  }

  return {
    skipped: false,
    perJudge,
    panel,
    disagreements,
    truncated: hidden > 0,
    note: HUMAN_NOTE,
  };
}

export function panelBuild(
  items: PanelItem[],
  blind: boolean,
  rubric?: string,
): PanelBuild {
  return {
    blind,
    rubric,
    items: items.map((item) => ({ id: item.id, files: [...item.files] })),
    files: panelEvidenceFiles(items),
    note: blind
      ? "Evidence paths are attachments only and are omitted from the prompt text."
      : "Informed panel. extraContext is visible to judges.",
  };
}

function summarize(pairs: Array<[string, string]>): VoteComparison {
  return {
    compared: pairs.length,
    exactMatches: pairs.filter(([left, right]) => left === right).length,
    kappa: cohenKappa(pairs),
  };
}

function pushDisagreement(
  disagreements: PanelDisagreement[],
  row: PanelDisagreement,
): number {
  if (disagreements.length >= DISAGREEMENT_CAP) return 1;
  disagreements.push(row);
  return 0;
}
