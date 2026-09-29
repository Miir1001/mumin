import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AiTask, AiTaskPriority, AiTaskStatus, AiWorkerStatus, ApprovalStatus, Prisma } from "@talenthub/database";
import { PrismaService } from "../../prisma/prisma.service";
import { findTaskType, findWorkerRole } from "../catalog/worker-roles.catalog";
import { Page, assertCompanyExists, cursorArgs, toPage } from "../common/company-scope";
import { CreateTaskDto, ListTasksQueryDto } from "../dto/workforce.dto";
import { TaskQueueService } from "./task-queue.service";

const CANCELLABLE: AiTaskStatus[] = [AiTaskStatus.QUEUED, AiTaskStatus.AWAITING_APPROVAL];

const taskListInclude = {
  worker: { select: { id: true, name: true, roleKey: true } },
} satisfies Prisma.AiTaskInclude;

const taskDetailInclude = {
  worker: { select: { id: true, name: true, roleKey: true, department: true } },
  approvals: { orderBy: { createdAt: "desc" } },
  events: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.AiTaskInclude;

export type TaskListItem = Prisma.AiTaskGetPayload<{ include: typeof taskListInclude }>;
export type TaskDetail = Prisma.AiTaskGetPayload<{ include: typeof taskDetailInclude }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TaskQueueService,
  ) {}

  async create(companyId: string, workerId: string, dto: CreateTaskDto): Promise<AiTask> {
    const db = this.prisma.client;
    const worker = await db.aiWorker.findFirst({ where: { id: workerId, companyId } });
    if (!worker) {
      throw new NotFoundException(`AI worker ${workerId} not found`);
    }
    if (worker.status === AiWorkerStatus.RETIRED) {
      throw new ConflictException(`AI worker ${workerId} is retired`);
    }
    const role = findWorkerRole(worker.roleKey);
    if (!role || !findTaskType(role, dto.type)) {
      const allowed = role?.taskTypes.map((t) => t.key).join(", ") ?? "none";
      throw new BadRequestException(`"${dto.type}" is not a task type for this worker (allowed: ${allowed})`);
    }

    const priority = dto.priority ?? AiTaskPriority.NORMAL;
    const task = await db.aiTask.create({
      data: {
        workerId: worker.id,
        companyId,
        type: dto.type,
        title: dto.title,
        input: dto.input as Prisma.InputJsonValue,
        priority,
        amount: dto.amount,
        events: {
          create: {
            type: "created",
            message:
              worker.status === AiWorkerStatus.PAUSED ? "Queued; worker is paused and will pick it up on resume" : "Queued",
          },
        },
      },
    });

    if (worker.status === AiWorkerStatus.ACTIVE) {
      this.queue.enqueue(task.id, priority);
    }
    return task;
  }

  async list(companyId: string, query: ListTasksQueryDto): Promise<Page<TaskListItem>> {
    const db = this.prisma.client;
    await assertCompanyExists(db, companyId);
    const limit = query.limit ?? 20;
    const rows = await db.aiTask.findMany({
      where: {
        companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.workerId ? { workerId: query.workerId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorArgs(query.cursor, limit),
      include: taskListInclude,
    });
    return toPage(rows, limit);
  }

  async get(companyId: string, taskId: string): Promise<TaskDetail> {
    const task = await this.prisma.client.aiTask.findFirst({
      where: { id: taskId, companyId },
      include: taskDetailInclude,
    });
    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }
    return task;
  }

  async cancel(companyId: string, taskId: string): Promise<TaskDetail> {
    const db = this.prisma.client;
    await db.$transaction(async (tx) => {
      const updated = await tx.aiTask.updateMany({
        where: { id: taskId, companyId, status: { in: CANCELLABLE } },
        data: { status: AiTaskStatus.CANCELLED, completedAt: new Date() },
      });
      if (updated.count === 0) {
        await this.throwForUnexpectedState(companyId, taskId, "cancelled");
      }
      await tx.approvalRequest.updateMany({
        where: { taskId, status: ApprovalStatus.PENDING },
        data: { status: ApprovalStatus.REJECTED, decidedAt: new Date(), decisionNote: "Task was cancelled" },
      });
      await tx.aiTaskEvent.create({ data: { taskId, type: "cancelled", message: "Cancelled by a user" } });
    });
    return this.get(companyId, taskId);
  }

  async retry(companyId: string, taskId: string): Promise<TaskDetail> {
    const db = this.prisma.client;
    const task = await db.$transaction(async (tx) => {
      const updated = await tx.aiTask.updateMany({
        where: { id: taskId, companyId, status: AiTaskStatus.FAILED, worker: { status: { not: AiWorkerStatus.RETIRED } } },
        data: { status: AiTaskStatus.QUEUED, attempts: 0, error: null, completedAt: null },
      });
      if (updated.count === 0) {
        await this.throwForUnexpectedState(companyId, taskId, "retried");
      }
      await tx.aiTaskEvent.create({ data: { taskId, type: "retried", message: "Re-queued by a user" } });
      return tx.aiTask.findUniqueOrThrow({ where: { id: taskId }, include: { worker: { select: { status: true } } } });
    });

    if (task.worker.status === AiWorkerStatus.ACTIVE) {
      this.queue.enqueue(task.id, task.priority);
    }
    return this.get(companyId, taskId);
  }

  private async throwForUnexpectedState(companyId: string, taskId: string, action: string): Promise<never> {
    const task = await this.prisma.client.aiTask.findFirst({
      where: { id: taskId, companyId },
      select: { status: true },
    });
    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }
    throw new ConflictException(`Task ${taskId} is ${task.status} and cannot be ${action}`);
  }
}
