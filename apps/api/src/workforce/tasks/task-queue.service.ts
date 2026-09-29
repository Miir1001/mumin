import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiTaskPriority, AiTaskStatus, AiWorkerStatus } from "@talenthub/database";
import { PrismaService } from "../../prisma/prisma.service";
import { TaskRunnerService } from "./task-runner.service";

const PRIORITY_RANK: Record<AiTaskPriority, number> = {
  [AiTaskPriority.URGENT]: 0,
  [AiTaskPriority.HIGH]: 1,
  [AiTaskPriority.NORMAL]: 2,
  [AiTaskPriority.LOW]: 3,
};

interface QueueEntry {
  taskId: string;
  priority: AiTaskPriority;
}

/**
 * In-process, priority-ordered work queue with bounded concurrency. The database row is the source
 * of truth (the runner claims tasks atomically), so this queue only decides *when* to try a task and
 * can be swapped for a Redis-backed BullMQ queue for multi-instance deployments without touching the
 * runner or services.
 */
@Injectable()
export class TaskQueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TaskQueueService.name);
  private readonly concurrency: number;
  private readonly pending: QueueEntry[] = [];
  private readonly known = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private active = 0;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: TaskRunnerService,
    config: ConfigService,
  ) {
    this.concurrency = config.get<number>("workforce.concurrency") ?? 4;
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      // A task still RUNNING at boot was interrupted by a restart; give it back to the queue.
      const recovered = await this.prisma.client.aiTask.updateMany({
        where: { status: AiTaskStatus.RUNNING },
        data: { status: AiTaskStatus.QUEUED },
      });
      const queued = await this.prisma.client.aiTask.findMany({
        where: { status: AiTaskStatus.QUEUED, worker: { status: AiWorkerStatus.ACTIVE } },
        select: { id: true, priority: true },
        orderBy: { createdAt: "asc" },
      });
      queued.forEach((task) => this.enqueue(task.id, task.priority));
      if (queued.length > 0) {
        this.logger.log(`Resumed ${queued.length} queued AI task(s) (${recovered.count} recovered from RUNNING)`);
      }
    } catch (error) {
      this.logger.error(`Could not resume queued AI tasks: ${error instanceof Error ? error.message : error}`);
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  enqueue(taskId: string, priority: AiTaskPriority = AiTaskPriority.NORMAL, delayMs = 0): void {
    if (this.stopped) return;
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.enqueue(taskId, priority);
      }, delayMs);
      this.timers.add(timer);
      return;
    }
    if (this.known.has(taskId)) return;

    this.known.add(taskId);
    const index = this.pending.findIndex((entry) => PRIORITY_RANK[entry.priority] > PRIORITY_RANK[priority]);
    this.pending.splice(index === -1 ? this.pending.length : index, 0, { taskId, priority });
    this.drain();
  }

  private drain(): void {
    while (!this.stopped && this.active < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      this.active += 1;
      void this.process(entry).finally(() => {
        this.active -= 1;
        this.known.delete(entry.taskId);
        this.drain();
      });
    }
  }

  private async process(entry: QueueEntry): Promise<void> {
    try {
      const result = await this.runner.run(entry.taskId);
      if (result.kind === "retry") {
        this.enqueue(entry.taskId, entry.priority, result.delayMs);
      }
    } catch (error) {
      this.logger.error(`AI task ${entry.taskId} crashed: ${error instanceof Error ? error.stack : error}`);
    }
  }
}
