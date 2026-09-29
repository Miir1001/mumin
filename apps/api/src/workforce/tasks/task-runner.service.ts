import { Inject, Injectable, Logger } from "@nestjs/common";
import { AiTaskStatus, AiWorkerStatus, Prisma } from "@talenthub/database";
import { PrismaService } from "../../prisma/prisma.service";
import { findTaskType, findWorkerRole } from "../catalog/worker-roles.catalog";
import { AI_EXECUTOR, AiExecutionError, AiExecutionResult, AiExecutor } from "../executor/ai-executor";
import { evaluateApproval, resolvePolicy } from "../policy/approval-policy";

export const MAX_TASK_ATTEMPTS = 3;

export type TaskRunResult =
  | { kind: "skipped" }
  | { kind: "completed" }
  | { kind: "awaiting_approval" }
  | { kind: "retry"; delayMs: number }
  | { kind: "failed" };

/** Executes a single queued task end to end: claim, run the AI worker, apply the approval policy. */
@Injectable()
export class TaskRunnerService {
  private readonly logger = new Logger(TaskRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_EXECUTOR) private readonly executor: AiExecutor,
  ) {}

  async run(taskId: string): Promise<TaskRunResult> {
    const db = this.prisma.client;

    // Atomic claim: only one runner can move a task out of QUEUED, and paused/retired workers don't work.
    const claimed = await db.aiTask.updateMany({
      where: { id: taskId, status: AiTaskStatus.QUEUED, worker: { status: AiWorkerStatus.ACTIVE } },
      data: { status: AiTaskStatus.RUNNING, attempts: { increment: 1 }, startedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { kind: "skipped" };
    }

    const task = await db.aiTask.findUniqueOrThrow({ where: { id: taskId }, include: { worker: true } });
    const role = findWorkerRole(task.worker.roleKey);
    const taskType = role && findTaskType(role, task.type);
    if (!role || !taskType) {
      return this.fail(taskId, task.attempts, new AiExecutionError(`Unknown role or task type "${task.type}"`, false));
    }

    let result: AiExecutionResult;
    try {
      result = await this.executor.execute({
        role,
        taskType,
        workerName: task.worker.name,
        instructions: task.worker.instructions,
        title: task.title,
        input: task.input,
      });
    } catch (error) {
      const executionError =
        error instanceof AiExecutionError
          ? error
          : new AiExecutionError(error instanceof Error ? error.message : "Unknown error", true);
      return this.fail(taskId, task.attempts, executionError);
    }

    const { output } = result;
    const requestedAmount = task.amount === null ? null : task.amount.toNumber();
    const amount = maxAmount(requestedAmount, output.proposedAction.amount);
    const decision = evaluateApproval(resolvePolicy(role.defaultPolicy, task.worker.approvalPolicy), {
      taskType: task.type,
      taskTypeAlwaysRequiresApproval: taskType.alwaysRequiresApproval,
      amount,
      confidence: output.confidence,
      assessedRisk: output.riskLevel,
      workerRequestedReview: output.needsHumanReview,
    });

    const now = new Date();
    await db.$transaction(async (tx) => {
      const updated = await tx.aiTask.updateMany({
        where: { id: taskId, status: AiTaskStatus.RUNNING },
        data: {
          status: decision.requiresApproval ? AiTaskStatus.AWAITING_APPROVAL : AiTaskStatus.COMPLETED,
          output: { ...output, model: result.model } as Prisma.InputJsonValue,
          confidence: output.confidence,
          riskLevel: decision.riskLevel,
          amount,
          error: null,
          inputTokens: { increment: result.inputTokens },
          outputTokens: { increment: result.outputTokens },
          completedAt: decision.requiresApproval ? null : now,
        },
      });
      if (updated.count === 0) {
        throw new Error(`Task ${taskId} left RUNNING while it was being processed`);
      }

      if (decision.requiresApproval) {
        await tx.approvalRequest.create({
          data: {
            taskId,
            companyId: task.companyId,
            riskLevel: decision.riskLevel,
            reasons: decision.reasons,
            proposedAction: output.proposedAction as Prisma.InputJsonValue,
          },
        });
      }
      await tx.aiTaskEvent.create({
        data: decision.requiresApproval
          ? {
              taskId,
              type: "approval_requested",
              message: `Sent for human approval (${decision.riskLevel} risk)`,
              data: { reasons: decision.reasons },
            }
          : {
              taskId,
              type: "completed",
              message: `Auto-approved by policy: ${output.proposedAction.description}`,
              data: { action: output.proposedAction.type },
            },
      });
    });

    return decision.requiresApproval ? { kind: "awaiting_approval" } : { kind: "completed" };
  }

  private async fail(taskId: string, attempts: number, error: AiExecutionError): Promise<TaskRunResult> {
    const willRetry = error.retryable && attempts < MAX_TASK_ATTEMPTS;
    this.logger.warn(`Task ${taskId} attempt ${attempts} failed${willRetry ? " (will retry)" : ""}: ${error.message}`);

    await this.prisma.client.$transaction([
      this.prisma.client.aiTask.update({
        where: { id: taskId },
        data: willRetry
          ? { status: AiTaskStatus.QUEUED, error: error.message }
          : { status: AiTaskStatus.FAILED, error: error.message, completedAt: new Date() },
      }),
      this.prisma.client.aiTaskEvent.create({
        data: {
          taskId,
          type: willRetry ? "retry_scheduled" : "failed",
          message: willRetry ? `Attempt ${attempts} failed, retrying: ${error.message}` : error.message,
        },
      }),
    ]);

    return willRetry ? { kind: "retry", delayMs: retryDelayMs(attempts) } : { kind: "failed" };
  }
}

/** Exponential backoff: 5s, 20s, 45s, ... */
export function retryDelayMs(attempts: number): number {
  return attempts * attempts * 5_000;
}

function maxAmount(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
