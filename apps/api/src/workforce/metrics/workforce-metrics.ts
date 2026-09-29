import { AiTaskStatus, AiWorkerStatus } from "@talenthub/database";
import { findWorkerRole } from "../catalog/worker-roles.catalog";

export interface MetricsInput {
  days: number;
  workers: { roleKey: string; status: AiWorkerStatus }[];
  taskCountsByStatus: Partial<Record<AiTaskStatus, number>>;
  completedByRole: { roleKey: string; count: number }[];
  /** Completed tasks that went through a human approval (the rest were fully automated). */
  completedWithApproval: number;
  pendingApprovals: number;
  /** Decision latencies of approvals decided in the window, in milliseconds. */
  approvalTurnaroundsMs: number[];
  inputTokens: number;
  outputTokens: number;
}

export interface WorkforceMetrics {
  periodDays: number;
  workers: { active: number; paused: number; total: number };
  tasks: Record<AiTaskStatus, number> & { total: number };
  completionRate: number | null;
  automationRate: number | null;
  pendingApprovals: number;
  avgApprovalTurnaroundMinutes: number | null;
  hoursSaved: number;
  laborCostAvoidedUsd: number;
  workforceCostUsd: number;
  netSavingsUsd: number;
  tokens: { input: number; output: number };
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Turns raw counts into the numbers an operations leader cares about: how much work the AI
 * workforce did, how much of it needed a human, and what it saved versus doing it by hand.
 */
export function computeWorkforceMetrics(input: MetricsInput): WorkforceMetrics {
  const tasks = Object.fromEntries(
    Object.values(AiTaskStatus).map((status) => [status, input.taskCountsByStatus[status] ?? 0]),
  ) as Record<AiTaskStatus, number>;
  const total = Object.values(tasks).reduce((sum, n) => sum + n, 0);
  const finished = tasks.COMPLETED + tasks.REJECTED + tasks.FAILED;

  let minutesSaved = 0;
  let laborCostAvoided = 0;
  for (const { roleKey, count } of input.completedByRole) {
    const role = findWorkerRole(roleKey);
    if (!role) continue;
    minutesSaved += count * role.minutesSavedPerTask;
    laborCostAvoided += ((count * role.minutesSavedPerTask) / 60) * role.humanHourlyCostUsd;
  }

  // Retired workers are no longer billed; subscription cost is prorated to the reporting window.
  const billable = input.workers.filter((w) => w.status !== AiWorkerStatus.RETIRED);
  const workforceCost = billable.reduce(
    (sum, w) => sum + ((findWorkerRole(w.roleKey)?.monthlyPriceUsd ?? 0) * input.days) / 30,
    0,
  );

  const turnarounds = input.approvalTurnaroundsMs;
  return {
    periodDays: input.days,
    workers: {
      active: input.workers.filter((w) => w.status === AiWorkerStatus.ACTIVE).length,
      paused: input.workers.filter((w) => w.status === AiWorkerStatus.PAUSED).length,
      total: billable.length,
    },
    tasks: { ...tasks, total },
    completionRate: finished > 0 ? round(tasks.COMPLETED / finished, 4) : null,
    automationRate: tasks.COMPLETED > 0 ? round(1 - input.completedWithApproval / tasks.COMPLETED, 4) : null,
    pendingApprovals: input.pendingApprovals,
    avgApprovalTurnaroundMinutes:
      turnarounds.length > 0 ? round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length / 60_000, 1) : null,
    hoursSaved: round(minutesSaved / 60, 1),
    laborCostAvoidedUsd: round(laborCostAvoided),
    workforceCostUsd: round(workforceCost),
    netSavingsUsd: round(laborCostAvoided - workforceCost),
    tokens: { input: input.inputTokens, output: input.outputTokens },
  };
}
