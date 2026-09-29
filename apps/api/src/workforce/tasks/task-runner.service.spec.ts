import { AiTaskStatus, AiWorkerStatus, Prisma, RiskLevel } from "@talenthub/database";
import type { PrismaService } from "../../prisma/prisma.service";
import { AiExecutionError, AiExecutor, WorkerOutput } from "../executor/ai-executor";
import { MAX_TASK_ATTEMPTS, TaskRunnerService, retryDelayMs } from "./task-runner.service";

function makeOutput(overrides: Partial<WorkerOutput> = {}): WorkerOutput {
  return {
    summary: "Invoice matches PO-77; ready to pay.",
    details: [{ label: "Invoice total", value: "840.00 USD" }],
    draft: null,
    proposedAction: { type: "approve_invoice", description: "Schedule INV-2291 for payment", amount: 840 },
    confidence: 0.97,
    riskLevel: "LOW",
    riskFactors: [],
    needsHumanReview: false,
    ...overrides,
  };
}

function setup(options: { claimed?: number; amount?: number | null; execute?: AiExecutor["execute"] } = {}) {
  const task = {
    id: "task_1",
    companyId: "co_1",
    type: "process-invoice",
    title: "Invoice INV-2291",
    input: { invoice: { total: 840 } },
    amount: options.amount === undefined || options.amount === null ? null : new Prisma.Decimal(options.amount),
    attempts: 1,
    worker: {
      name: "Ava",
      roleKey: "finance-clerk",
      instructions: null,
      status: AiWorkerStatus.ACTIVE,
      approvalPolicy: {},
    },
  };

  const tx = {
    aiTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    approvalRequest: { create: jest.fn().mockResolvedValue({}) },
    aiTaskEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const client = {
    aiTask: {
      updateMany: jest.fn().mockResolvedValue({ count: options.claimed ?? 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(task),
      update: jest.fn((args: unknown) => args),
    },
    aiTaskEvent: { create: jest.fn((args: unknown) => args) },
    $transaction: jest.fn((arg: unknown) => (typeof arg === "function" ? arg(tx) : Promise.resolve(arg))),
  };
  const executor: AiExecutor = {
    execute:
      options.execute ??
      jest.fn().mockResolvedValue({ output: makeOutput(), model: "claude-opus-5-5", inputTokens: 900, outputTokens: 300 }),
  };
  const runner = new TaskRunnerService({ client } as unknown as PrismaService, executor);
  return { runner, client, tx, executor };
}

describe("TaskRunnerService", () => {
  it("skips tasks it could not claim (already taken, cancelled, or worker paused)", async () => {
    const { runner, executor } = setup({ claimed: 0 });

    await expect(runner.run("task_1")).resolves.toEqual({ kind: "skipped" });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("auto-completes an outcome that passes the approval policy", async () => {
    const { runner, tx } = setup({ amount: 840 });

    // finance-clerk default auto-approves up to 1,000 at >= 0.9 confidence.
    await expect(runner.run("task_1")).resolves.toEqual({ kind: "completed" });
    expect(tx.aiTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task_1", status: AiTaskStatus.RUNNING },
        data: expect.objectContaining({ status: AiTaskStatus.COMPLETED, riskLevel: RiskLevel.LOW }),
      }),
    );
    expect(tx.approvalRequest.create).not.toHaveBeenCalled();
    expect(tx.aiTaskEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "completed" }) });
  });

  it("parks the task for human approval when the amount exceeds the limit", async () => {
    const { runner, tx } = setup({
      execute: jest.fn().mockResolvedValue({
        output: makeOutput({ proposedAction: { type: "approve_invoice", description: "Pay", amount: 4_200 } }),
        model: "claude-opus-5-5",
        inputTokens: 1,
        outputTokens: 1,
      }),
    });

    await expect(runner.run("task_1")).resolves.toEqual({ kind: "awaiting_approval" });
    expect(tx.aiTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AiTaskStatus.AWAITING_APPROVAL, riskLevel: RiskLevel.HIGH, amount: 4_200 }),
      }),
    );
    expect(tx.approvalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: "task_1", companyId: "co_1", riskLevel: RiskLevel.HIGH }),
    });
  });

  it("uses the larger of the requested and proposed amounts", async () => {
    const { runner, tx } = setup({ amount: 5_000 });

    await expect(runner.run("task_1")).resolves.toEqual({ kind: "awaiting_approval" });
    expect(tx.aiTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 5_000 }) }),
    );
  });

  it("re-queues retryable failures with backoff", async () => {
    const { runner, client } = setup({
      execute: jest.fn().mockRejectedValue(new AiExecutionError("rate limited", true)),
    });

    await expect(runner.run("task_1")).resolves.toEqual({ kind: "retry", delayMs: retryDelayMs(1) });
    expect(client.aiTask.update).toHaveBeenCalledWith({
      where: { id: "task_1" },
      data: { status: AiTaskStatus.QUEUED, error: "rate limited" },
    });
  });

  it("fails permanently on non-retryable errors", async () => {
    const { runner, client } = setup({
      execute: jest.fn().mockRejectedValue(new AiExecutionError("AI provider is not configured", false)),
    });

    await expect(runner.run("task_1")).resolves.toEqual({ kind: "failed" });
    expect(client.aiTask.update).toHaveBeenCalledWith({
      where: { id: "task_1" },
      data: expect.objectContaining({ status: AiTaskStatus.FAILED }),
    });
  });

  it("stops retrying after the maximum number of attempts", async () => {
    const { runner, client } = setup({
      execute: jest.fn().mockRejectedValue(new AiExecutionError("overloaded", true)),
    });
    client.aiTask.findUniqueOrThrow.mockResolvedValueOnce({
      ...(await client.aiTask.findUniqueOrThrow()),
      attempts: MAX_TASK_ATTEMPTS,
    });

    await expect(runner.run("task_1")).resolves.toEqual({ kind: "failed" });
  });
});
