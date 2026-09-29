import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AiTaskStatus, AiWorker, AiWorkerStatus, ApprovalStatus, Prisma } from "@talenthub/database";
import { PrismaService } from "../../prisma/prisma.service";
import { findWorkerRole } from "../catalog/worker-roles.catalog";
import { assertCompanyExists } from "../common/company-scope";
import { ApprovalPolicyDto, HireWorkerDto, UpdateWorkerDto } from "../dto/workforce.dto";
import { resolvePolicy } from "../policy/approval-policy";
import { TaskQueueService } from "../tasks/task-queue.service";

const workerListInclude = {
  _count: { select: { tasks: { where: { status: AiTaskStatus.AWAITING_APPROVAL } } } },
} satisfies Prisma.AiWorkerInclude;

export type WorkerListItem = Prisma.AiWorkerGetPayload<{ include: typeof workerListInclude }>;

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TaskQueueService,
  ) {}

  async hire(companyId: string, dto: HireWorkerDto): Promise<AiWorker> {
    const db = this.prisma.client;
    await assertCompanyExists(db, companyId);
    const role = findWorkerRole(dto.roleKey);
    if (!role) {
      throw new BadRequestException(`Unknown AI worker role "${dto.roleKey}"`);
    }

    return db.aiWorker.create({
      data: {
        companyId,
        roleKey: role.key,
        department: role.department,
        name: dto.name ?? role.name,
        instructions: dto.instructions,
        approvalPolicy: this.mergePolicy(role.defaultPolicy, {}, dto.approvalPolicy),
      },
    });
  }

  async list(companyId: string, status?: AiWorkerStatus): Promise<WorkerListItem[]> {
    const db = this.prisma.client;
    await assertCompanyExists(db, companyId);
    return db.aiWorker.findMany({
      where: { companyId, ...(status ? { status } : { status: { not: AiWorkerStatus.RETIRED } }) },
      orderBy: { hiredAt: "desc" },
      include: workerListInclude,
    });
  }

  async get(companyId: string, workerId: string): Promise<AiWorker> {
    const worker = await this.prisma.client.aiWorker.findFirst({ where: { id: workerId, companyId } });
    if (!worker) {
      throw new NotFoundException(`AI worker ${workerId} not found`);
    }
    return worker;
  }

  async update(companyId: string, workerId: string, dto: UpdateWorkerDto): Promise<AiWorker> {
    const worker = await this.get(companyId, workerId);
    this.assertNotRetired(worker);
    const role = findWorkerRole(worker.roleKey);

    return this.prisma.client.aiWorker.update({
      where: { id: worker.id },
      data: {
        name: dto.name,
        instructions: dto.instructions,
        approvalPolicy:
          dto.approvalPolicy && role
            ? this.mergePolicy(role.defaultPolicy, worker.approvalPolicy, dto.approvalPolicy)
            : undefined,
      },
    });
  }

  async pause(companyId: string, workerId: string): Promise<AiWorker> {
    const worker = await this.get(companyId, workerId);
    this.assertNotRetired(worker);
    // Queued tasks stay QUEUED; the runner won't claim tasks for a paused worker.
    return this.prisma.client.aiWorker.update({ where: { id: worker.id }, data: { status: AiWorkerStatus.PAUSED } });
  }

  async resume(companyId: string, workerId: string): Promise<AiWorker> {
    const worker = await this.get(companyId, workerId);
    this.assertNotRetired(worker);
    const updated = await this.prisma.client.aiWorker.update({
      where: { id: worker.id },
      data: { status: AiWorkerStatus.ACTIVE },
    });

    const queued = await this.prisma.client.aiTask.findMany({
      where: { workerId: worker.id, status: AiTaskStatus.QUEUED },
      select: { id: true, priority: true },
      orderBy: { createdAt: "asc" },
    });
    queued.forEach((task) => this.queue.enqueue(task.id, task.priority));
    return updated;
  }

  /** Permanently offboards a worker: outstanding work is cancelled and pending approvals closed. */
  async retire(companyId: string, workerId: string): Promise<AiWorker> {
    const worker = await this.get(companyId, workerId);
    this.assertNotRetired(worker);

    return this.prisma.client.$transaction(async (tx) => {
      const open = await tx.aiTask.findMany({
        where: { workerId: worker.id, status: { in: [AiTaskStatus.QUEUED, AiTaskStatus.AWAITING_APPROVAL] } },
        select: { id: true },
      });
      const openIds = open.map((t) => t.id);
      if (openIds.length > 0) {
        await tx.aiTask.updateMany({
          where: { id: { in: openIds } },
          data: { status: AiTaskStatus.CANCELLED, completedAt: new Date() },
        });
        await tx.approvalRequest.updateMany({
          where: { taskId: { in: openIds }, status: ApprovalStatus.PENDING },
          data: { status: ApprovalStatus.REJECTED, decidedAt: new Date(), decisionNote: "AI worker was retired" },
        });
        await tx.aiTaskEvent.createMany({
          data: openIds.map((taskId) => ({ taskId, type: "cancelled", message: "Cancelled: AI worker was retired" })),
        });
      }
      return tx.aiWorker.update({
        where: { id: worker.id },
        data: { status: AiWorkerStatus.RETIRED, retiredAt: new Date() },
      });
    });
  }

  private assertNotRetired(worker: AiWorker): void {
    if (worker.status === AiWorkerStatus.RETIRED) {
      throw new ConflictException(`AI worker ${worker.id} is retired`);
    }
  }

  private mergePolicy(
    defaults: Parameters<typeof resolvePolicy>[0],
    current: unknown,
    changes: ApprovalPolicyDto | undefined,
  ): Prisma.InputJsonValue {
    const base = resolvePolicy(defaults, current);
    const defined = Object.fromEntries(Object.entries(changes ?? {}).filter(([, value]) => value !== undefined));
    return { ...base, ...defined } as Prisma.InputJsonValue;
  }
}
