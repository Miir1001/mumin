import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AiTask, AiWorker } from "@talenthub/database";
import { ApprovalListItem, ApprovalsService, DecidedApproval } from "./approvals/approvals.service";
import { WORKER_ROLES } from "./catalog/worker-roles.catalog";
import {
  CreateTaskDto,
  DecideApprovalDto,
  HireWorkerDto,
  ListApprovalsQueryDto,
  ListTasksQueryDto,
  ListWorkersQueryDto,
  MetricsQueryDto,
  UpdateWorkerDto,
} from "./dto/workforce.dto";
import { Page } from "./common/company-scope";
import { MetricsService } from "./metrics/metrics.service";
import { WorkforceMetrics } from "./metrics/workforce-metrics";
import { TaskDetail, TaskListItem, TasksService } from "./tasks/tasks.service";
import { WorkerListItem, WorkersService } from "./workers/workers.service";

@ApiTags("workforce")
@Controller("workforce")
export class WorkforceCatalogController {
  @Get("catalog")
  @ApiOperation({ summary: "List the AI worker roles an organization can hire" })
  catalog() {
    // Prompts are internal; expose what a buyer needs to choose and configure a worker.
    return WORKER_ROLES.map((role) => ({
      key: role.key,
      name: role.name,
      department: role.department,
      description: role.description,
      capabilities: role.capabilities,
      taskTypes: role.taskTypes,
      defaultPolicy: role.defaultPolicy,
      monthlyPriceUsd: role.monthlyPriceUsd,
      humanHourlyCostUsd: role.humanHourlyCostUsd,
      minutesSavedPerTask: role.minutesSavedPerTask,
    }));
  }
}

@ApiTags("workforce")
@Controller("companies/:companyId/workforce")
export class WorkforceController {
  constructor(
    private readonly workers: WorkersService,
    private readonly tasks: TasksService,
    private readonly approvals: ApprovalsService,
    private readonly metrics: MetricsService,
  ) {}

  // --- Workers --------------------------------------------------------------

  @Post("workers")
  @ApiOperation({ summary: "Hire an AI worker from the catalog" })
  hire(@Param("companyId") companyId: string, @Body() dto: HireWorkerDto): Promise<AiWorker> {
    return this.workers.hire(companyId, dto);
  }

  @Get("workers")
  @ApiOperation({ summary: "List AI workers (retired workers only when filtered by status)" })
  listWorkers(@Param("companyId") companyId: string, @Query() query: ListWorkersQueryDto): Promise<WorkerListItem[]> {
    return this.workers.list(companyId, query.status);
  }

  @Get("workers/:workerId")
  getWorker(@Param("companyId") companyId: string, @Param("workerId") workerId: string): Promise<AiWorker> {
    return this.workers.get(companyId, workerId);
  }

  @Patch("workers/:workerId")
  @ApiOperation({ summary: "Rename a worker or change its instructions and approval policy" })
  updateWorker(
    @Param("companyId") companyId: string,
    @Param("workerId") workerId: string,
    @Body() dto: UpdateWorkerDto,
  ): Promise<AiWorker> {
    return this.workers.update(companyId, workerId, dto);
  }

  @Post("workers/:workerId/pause")
  @HttpCode(HttpStatus.OK)
  pause(@Param("companyId") companyId: string, @Param("workerId") workerId: string): Promise<AiWorker> {
    return this.workers.pause(companyId, workerId);
  }

  @Post("workers/:workerId/resume")
  @HttpCode(HttpStatus.OK)
  resume(@Param("companyId") companyId: string, @Param("workerId") workerId: string): Promise<AiWorker> {
    return this.workers.resume(companyId, workerId);
  }

  @Post("workers/:workerId/retire")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Offboard a worker; its open tasks are cancelled" })
  retire(@Param("companyId") companyId: string, @Param("workerId") workerId: string): Promise<AiWorker> {
    return this.workers.retire(companyId, workerId);
  }

  // --- Tasks ----------------------------------------------------------------

  @Post("workers/:workerId/tasks")
  @ApiOperation({ summary: "Assign a task to an AI worker; it is processed asynchronously" })
  createTask(
    @Param("companyId") companyId: string,
    @Param("workerId") workerId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<AiTask> {
    return this.tasks.create(companyId, workerId, dto);
  }

  @Get("tasks")
  listTasks(@Param("companyId") companyId: string, @Query() query: ListTasksQueryDto): Promise<Page<TaskListItem>> {
    return this.tasks.list(companyId, query);
  }

  @Get("tasks/:taskId")
  @ApiOperation({ summary: "Task detail with output, approvals, and full event timeline" })
  getTask(@Param("companyId") companyId: string, @Param("taskId") taskId: string): Promise<TaskDetail> {
    return this.tasks.get(companyId, taskId);
  }

  @Post("tasks/:taskId/cancel")
  @HttpCode(HttpStatus.OK)
  cancelTask(@Param("companyId") companyId: string, @Param("taskId") taskId: string): Promise<TaskDetail> {
    return this.tasks.cancel(companyId, taskId);
  }

  @Post("tasks/:taskId/retry")
  @HttpCode(HttpStatus.OK)
  retryTask(@Param("companyId") companyId: string, @Param("taskId") taskId: string): Promise<TaskDetail> {
    return this.tasks.retry(companyId, taskId);
  }

  // --- Approvals ------------------------------------------------------------

  @Get("approvals")
  @ApiOperation({ summary: "Human approval queue (pending by default, riskiest first)" })
  listApprovals(@Param("companyId") companyId: string, @Query() query: ListApprovalsQueryDto): Promise<Page<ApprovalListItem>> {
    return this.approvals.list(companyId, query);
  }

  @Post("approvals/:approvalId/approve")
  @HttpCode(HttpStatus.OK)
  approve(
    @Param("companyId") companyId: string,
    @Param("approvalId") approvalId: string,
    @Body() dto: DecideApprovalDto,
  ): Promise<DecidedApproval> {
    return this.approvals.decide(companyId, approvalId, "approve", dto.note);
  }

  @Post("approvals/:approvalId/reject")
  @HttpCode(HttpStatus.OK)
  reject(
    @Param("companyId") companyId: string,
    @Param("approvalId") approvalId: string,
    @Body() dto: DecideApprovalDto,
  ): Promise<DecidedApproval> {
    return this.approvals.decide(companyId, approvalId, "reject", dto.note);
  }

  // --- Metrics --------------------------------------------------------------

  @Get("metrics")
  @ApiOperation({ summary: "Productivity, automation rate, and cost savings for the period" })
  getMetrics(@Param("companyId") companyId: string, @Query() query: MetricsQueryDto): Promise<WorkforceMetrics> {
    return this.metrics.overview(companyId, query.days);
  }
}
