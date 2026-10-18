import { z } from "zod";
import { getWorkspaceRoot, loadConfig } from "../config.js";
import { observeHarnesses } from "../harness/observe.js";
import {
  searchHarnesses,
  type HarnessObservation,
  type SearchRow,
} from "../harness/registry.js";

export const swarmSearchInputSchema = z.object({
  query: z.string().max(200).optional(),
});

export async function swarmSearch(
  query?: string,
  observations?: HarnessObservation[],
): Promise<{ ok: true; harnesses: SearchRow[] }> {
  const workspaceRoot = getWorkspaceRoot();
  const config = loadConfig(workspaceRoot);
  const rows =
    observations ?? (await observeHarnesses(workspaceRoot, config.detectionTimeoutMs));
  return { ok: true, harnesses: searchHarnesses(rows, query) };
}
