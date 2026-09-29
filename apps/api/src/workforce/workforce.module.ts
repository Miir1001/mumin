import { Module } from "@nestjs/common";
import { ApprovalsService } from "./approvals/approvals.service";
import { AI_EXECUTOR } from "./executor/ai-executor";
import { AnthropicExecutor } from "./executor/anthropic-executor";
import { MetricsService } from "./metrics/metrics.service";
import { TaskQueueService } from "./tasks/task-queue.service";
import { TaskRunnerService } from "./tasks/task-runner.service";
import { TasksService } from "./tasks/tasks.service";
import { WorkersService } from "./workers/workers.service";
import { WorkforceCatalogController, WorkforceController } from "./workforce.controller";

@Module({
  controllers: [WorkforceCatalogController, WorkforceController],
  providers: [
    { provide: AI_EXECUTOR, useClass: AnthropicExecutor },
    TaskRunnerService,
    TaskQueueService,
    WorkersService,
    TasksService,
    ApprovalsService,
    MetricsService,
  ],
})
export class WorkforceModule {}
