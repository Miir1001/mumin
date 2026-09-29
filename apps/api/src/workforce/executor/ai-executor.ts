import { z } from "zod/v4";
import type { TaskTypeDefinition, WorkerRoleDefinition } from "../catalog/worker-roles.catalog";

/**
 * What every AI worker must return for every task. Structured so the approval policy can reason
 * about it (amount, confidence, risk) and so reviewers see a consistent shape in the approval queue.
 */
export const workerOutputSchema = z.object({
  summary: z.string().describe("One or two sentences a busy manager can read to understand the outcome."),
  details: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe("Key facts, extracted fields, or findings as label/value pairs."),
  draft: z
    .string()
    .nullable()
    .describe("Any text deliverable (email, reply, letter, report), or null if the task has none."),
  proposedAction: z.object({
    type: z.string().describe("Short machine-friendly verb, e.g. 'approve_invoice', 'send_reply', 'reject_claim'."),
    description: z.string().describe("What will happen if a human (or the policy) approves this."),
    amount: z.number().nullable().describe("Monetary value the action commits, or null if none."),
  }),
  confidence: z.number().min(0).max(1).describe("How confident you are that the outcome is correct (0-1)."),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).describe("Business risk if the action is wrong."),
  riskFactors: z.array(z.string()).describe("Specific reasons behind the risk level; empty if none."),
  needsHumanReview: z
    .boolean()
    .describe("True if anything is ambiguous, missing, suspicious, or outside your remit."),
});

export type WorkerOutput = z.infer<typeof workerOutputSchema>;

export interface AiExecutionRequest {
  role: WorkerRoleDefinition;
  taskType: TaskTypeDefinition;
  workerName: string;
  instructions: string | null;
  title: string;
  input: unknown;
}

export interface AiExecutionResult {
  output: WorkerOutput;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiExecutor {
  execute(request: AiExecutionRequest): Promise<AiExecutionResult>;
}

export const AI_EXECUTOR = Symbol("AI_EXECUTOR");

/** A failure that retrying the same task will not fix (bad config, refusal) versus a transient one. */
export class AiExecutionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiExecutionError";
  }
}
