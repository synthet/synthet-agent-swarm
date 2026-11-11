import { z } from "zod";
import type { HarnessObservation, SwarmError } from "../harness/registry.js";
import {
  swarmDecideTool,
  type StructuredAnswer,
  type SwarmDecideInput,
  type SwarmDecideResponse,
} from "./swarmDecide.js";

/**
 * Local stand-ins for the jev-mcp text tools. They use the same question
 * shapes and return answers under `result`, but they run a swarm harness.
 * They do not call TypeSafe, and they do not accept images or box questions.
 */

const state = z.unknown();
const instructions = z.string().trim().min(1).max(4000);
const criteriaObject = z.record(z.string().min(1).max(80), z.string().min(1).max(500)).refine(
  (value) => Object.keys(value).length > 0,
  "criteria must be a non-empty object",
);
const criteriaList = z.array(z.string().min(1).max(500)).min(1).max(20);
const model = z.string().min(1).max(200).optional();
const harnesses = z.array(z.string().min(1).max(40)).max(6).optional();
const timeoutMs = z.number().int().positive().max(60000).optional();
const dryRun = z.boolean().optional().default(false);
const questionId = z.string().min(1).max(120).optional().default("answer");

const shared = { state, model, harnesses, timeoutMs, dryRun };

export const swarmNoulInputSchema = z.object({
  ...shared,
  instructions,
  criteria: criteriaObject.optional(),
  question_id: questionId,
});

export const swarmChoiceInputSchema = z.object({
  ...shared,
  instructions,
  criteria: criteriaObject,
  question_id: questionId,
});

export const swarmScoreInputSchema = z.object({
  ...shared,
  instructions,
  criteria: criteriaList,
  question_id: questionId,
});

const systemQuestion = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    instructions,
    criteria: criteriaObject.optional(),
  }),
  z.object({
    type: z.literal("choice"),
    instructions,
    criteria: criteriaObject,
  }),
  z.object({
    type: z.literal("score"),
    instructions,
    criteria: criteriaList,
  }),
]);

export const swarmSystemOneInputSchema = z.object({
  state,
  questions: z.record(z.string().min(1).max(120), systemQuestion).refine(
    (value) => Object.keys(value).length > 0,
    "questions must contain at least one question",
  ),
  model,
  harnesses,
  timeoutMs,
  dryRun,
});

export interface SwarmJevResult {
  model: string | null;
  answers: Record<string, StructuredAnswer>;
  votes: SwarmDecideResponse["votes"];
}

export type SwarmJevResponse =
  | { ok: true; result: SwarmJevResult }
  | { ok: false; error?: SwarmError; votes: SwarmDecideResponse["votes"] };

export function toJevEnvelope(result: SwarmDecideResponse): SwarmJevResponse {
  if (!result.ok) return { ok: false, error: result.error, votes: result.votes };
  return {
    ok: true,
    result: { model: result.model, answers: result.answers, votes: result.votes },
  };
}

type Single = {
  state?: unknown;
  instructions: string;
  model?: string;
  harnesses?: string[];
  timeoutMs?: number;
  dryRun?: boolean;
  question_id: string;
  criteria?: Record<string, string> | string[];
};

async function decideOne(
  type: "noul" | "choice" | "score",
  input: Single,
  observations?: HarnessObservation[],
): Promise<SwarmJevResponse> {
  const spec: SwarmDecideInput["questions"][string] = {
    type,
    instructions: input.instructions,
    ...(input.criteria ? { criteria: input.criteria } : {}),
  };
  return toJevEnvelope(await swarmDecideTool({
    state: input.state,
    questions: { [input.question_id]: spec },
    model: input.model,
    harnesses: input.harnesses,
    timeoutMs: input.timeoutMs ?? 6000,
    dryRun: input.dryRun ?? false,
  }, observations));
}

export function swarmNoulTool(
  input: z.infer<typeof swarmNoulInputSchema>,
  observations?: HarnessObservation[],
) {
  return decideOne("noul", input, observations);
}

export function swarmChoiceTool(
  input: z.infer<typeof swarmChoiceInputSchema>,
  observations?: HarnessObservation[],
) {
  return decideOne("choice", input, observations);
}

export function swarmScoreTool(
  input: z.infer<typeof swarmScoreInputSchema>,
  observations?: HarnessObservation[],
) {
  return decideOne("score", input, observations);
}

export function swarmSystemOneTool(
  input: z.infer<typeof swarmSystemOneInputSchema>,
  observations?: HarnessObservation[],
) {
  return swarmDecideTool({
    state: input.state,
    questions: input.questions,
    model: input.model,
    harnesses: input.harnesses,
    timeoutMs: input.timeoutMs ?? 6000,
    dryRun: input.dryRun ?? false,
  }, observations).then(toJevEnvelope);
}
