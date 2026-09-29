import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AiTaskStatus, ApprovalStatus, Prisma } from "@talenthub/database";
import { PrismaService } from "../../prisma/prisma.service";
import { Page, assertCompanyExists, cursorArgs, toPage } from "../common/company-scope";
import { ListApprovalsQueryDto } from "../dto/workforce.dto";

export type ApprovalDecisionKind = "approve" | "reject";

const approvalListInclude = {
  task: {
    select: {
      id: true,
      title: true,
      type: true,
      amount: true,
      confidence: true,
      output: true,
      worker: { select: { id: true, name: true, roleKey: true } },
    },
  },
} satisfies Prisma.ApprovalRequestInclude;

export type ApprovalListItem = Prisma.ApprovalRequestGetPayload<{ include: typeof approvalListInclude }>;
export type DecidedApproval = Prisma.ApprovalRequestGetPayload<{ include: { task: true } }>;

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, query: ListApprovalsQueryDto): Promise<Page<ApprovalListItem>> {
    const db = this.prisma.client;
    await assertCompanyExists(db, companyId);
    const limit = query.limit ?? 20;
    const status = query.status ?? ApprovalStatus.PENDING;
    const rows = await db.approvalRequest.findMany({
      where: { companyId, status },
      // Pending queue: riskiest first, then oldest first so nothing starves. History: newest first.
      orderBy:
        status === ApprovalStatus.PENDING
          ? [{ riskLevel: "desc" }, { createdAt: "asc" }, { id: "asc" }]
          : [{ decidedAt: "desc" }, { id: "desc" }],
      ...cursorArgs(query.cursor, limit),
      include: approvalListInclude,
    });
    return toPage(rows, limit);
  }

  /**
   * Records a human decision. Approving completes the task (its proposed action is released for
   * execution); rejecting closes it. Guarded on PENDING so two reviewers can't both decide.
   */
  async decide(
    companyId: string,
    approvalId: string,
    decision: ApprovalDecisionKind,
    note?: string,
  ): Promise<DecidedApproval> {
    const db = this.prisma.client;
    const approved = decision === "approve";
    const now = new Date();

    return db.$transaction(async (tx) => {
      const approval = await tx.approvalRequest.findFirst({ where: { id: approvalId, companyId } });
      if (!approval) {
        throw new NotFoundException(`Approval request ${approvalId} not found`);
      }

      const updated = await tx.approvalRequest.updateMany({
        where: { id: approvalId, status: ApprovalStatus.PENDING },
        data: {
          status: approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
          decidedAt: now,
          decisionNote: note,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException(`Approval request ${approvalId} was already ${approval.status.toLowerCase()}`);
      }

      await tx.aiTask.updateMany({
        where: { id: approval.taskId, status: AiTaskStatus.AWAITING_APPROVAL },
        data: { status: approved ? AiTaskStatus.COMPLETED : AiTaskStatus.REJECTED, completedAt: now },
      });
      await tx.aiTaskEvent.create({
        data: {
          taskId: approval.taskId,
          type: approved ? "approved" : "rejected",
          message: `${approved ? "Approved" : "Rejected"} by a reviewer${note ? `: ${note}` : ""}`,
        },
      });

      return tx.approvalRequest.findUniqueOrThrow({ where: { id: approvalId }, include: { task: true } });
    });
  }
}
