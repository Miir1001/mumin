import { AiWorkerStatus } from "@talenthub/database";
import { MetricsInput, computeWorkforceMetrics } from "./workforce-metrics";

describe("computeWorkforceMetrics", () => {
  const base: MetricsInput = {
    days: 30,
    workers: [],
    taskCountsByStatus: {},
    completedByRole: [],
    completedWithApproval: 0,
    pendingApprovals: 0,
    approvalTurnaroundsMs: [],
    inputTokens: 0,
    outputTokens: 0,
  };

  it("returns zeros and null rates for an empty workforce", () => {
    const metrics = computeWorkforceMetrics(base);

    expect(metrics.tasks.total).toBe(0);
    expect(metrics.completionRate).toBeNull();
    expect(metrics.automationRate).toBeNull();
    expect(metrics.avgApprovalTurnaroundMinutes).toBeNull();
    expect(metrics.netSavingsUsd).toBe(0);
  });

  it("computes savings from role economics and prorates subscription cost", () => {
    const metrics = computeWorkforceMetrics({
      ...base,
      days: 15,
      // finance-clerk: $699/mo, 20 min/task at $45/h. Retired workers are not billed.
      workers: [
        { roleKey: "finance-clerk", status: AiWorkerStatus.ACTIVE },
        { roleKey: "finance-clerk", status: AiWorkerStatus.RETIRED },
      ],
      taskCountsByStatus: { COMPLETED: 90, REJECTED: 5, FAILED: 5, QUEUED: 3 },
      completedByRole: [{ roleKey: "finance-clerk", count: 90 }],
      completedWithApproval: 18,
    });

    expect(metrics.workers).toEqual({ active: 1, paused: 0, total: 1 });
    expect(metrics.tasks.total).toBe(103);
    expect(metrics.completionRate).toBe(0.9);
    expect(metrics.automationRate).toBe(0.8);
    expect(metrics.hoursSaved).toBe(30);
    expect(metrics.laborCostAvoidedUsd).toBe(1350);
    expect(metrics.workforceCostUsd).toBe(349.5);
    expect(metrics.netSavingsUsd).toBe(1000.5);
  });

  it("averages approval turnaround in minutes", () => {
    const metrics = computeWorkforceMetrics({ ...base, approvalTurnaroundsMs: [60_000, 180_000] });

    expect(metrics.avgApprovalTurnaroundMinutes).toBe(2);
  });

  it("ignores roles that are no longer in the catalog", () => {
    const metrics = computeWorkforceMetrics({ ...base, completedByRole: [{ roleKey: "removed-role", count: 10 }] });

    expect(metrics.hoursSaved).toBe(0);
  });
});
