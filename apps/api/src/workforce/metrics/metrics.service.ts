import { Injectable } from "@nestjs/common";
import { AiTaskStatus, ApprovalStatus } from "@talenthub/database";
import { PrismaService } from "../../prisma/prisma.service";
import { assertCompanyExists } from "../common/company-scope";
import { WorkforceMetrics, computeWorkforceMetrics } from "./workforce-metrics";

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(companyId: string, days = 30): Promise<WorkforceMetrics> {
    const db = this.prisma.client;
    await assertCompanyExists(db, companyId);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const inWindow = { companyId, createdAt: { gte: since } };

    const [workers, byStatus, completedByWorker, completedWithApproval, pendingApprovals, decided, tokens] =
      await Promise.all([
        db.aiWorker.findMany({ where: { companyId }, select: { id: true, roleKey: true, status: true } }),
        db.aiTask.groupBy({ by: ["status"], where: inWindow, _count: { _all: true } }),
        db.aiTask.groupBy({
          by: ["workerId"],
          where: { ...inWindow, status: AiTaskStatus.COMPLETED },
          _count: { _all: true },
        }),
        db.aiTask.count({
          where: { ...inWindow, status: AiTaskStatus.COMPLETED, approvals: { some: { status: ApprovalStatus.APPROVED } } },
        }),
        db.approvalRequest.count({ where: { companyId, status: ApprovalStatus.PENDING } }),
        db.approvalRequest.findMany({
          where: { companyId, decidedAt: { gte: since }, status: { not: ApprovalStatus.PENDING } },
          select: { createdAt: true, decidedAt: true },
        }),
        db.aiTask.aggregate({ where: inWindow, _sum: { inputTokens: true, outputTokens: true } }),
      ]);

    const roleByWorker = new Map(workers.map((w) => [w.id, w.roleKey]));
    return computeWorkforceMetrics({
      days,
      workers,
      taskCountsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      completedByRole: completedByWorker.map((row) => ({
        roleKey: roleByWorker.get(row.workerId) ?? "",
        count: row._count._all,
      })),
      completedWithApproval,
      pendingApprovals,
      approvalTurnaroundsMs: decided.map((a) => a.decidedAt!.getTime() - a.createdAt.getTime()),
      inputTokens: tokens._sum.inputTokens ?? 0,
      outputTokens: tokens._sum.outputTokens ?? 0,
    });
  }
}
