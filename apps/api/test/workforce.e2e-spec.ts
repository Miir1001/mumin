import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { prisma } from "@talenthub/database";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AI_EXECUTOR, AiExecutionRequest, AiExecutionResult, AiExecutor } from "../src/workforce/executor/ai-executor";

/** Deterministic stand-in for Claude: proposes paying whatever amount the task input carries. */
class FakeExecutor implements AiExecutor {
  async execute(req: AiExecutionRequest): Promise<AiExecutionResult> {
    const amount = Number((req.input as { total?: number }).total ?? 0);
    return {
      model: "fake",
      inputTokens: 100,
      outputTokens: 50,
      output: {
        summary: `Processed ${req.title}`,
        details: [{ label: "Total", value: String(amount) }],
        draft: null,
        proposedAction: { type: "approve_invoice", description: `Pay ${amount}`, amount },
        confidence: 0.95,
        riskLevel: "LOW",
        riskFactors: [],
        needsHumanReview: false,
      },
    };
  }
}

async function waitForStatus(app: INestApplication, path: string, statuses: string[]) {
  for (let i = 0; i < 50; i++) {
    const res = await request(app.getHttpServer()).get(path).expect(200);
    if (statuses.includes(res.body.status)) return res.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${path} never reached ${statuses.join("/")}`);
}

describe("Workforce (e2e)", () => {
  let app: INestApplication;
  let companyId: string;
  let base: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_EXECUTOR)
      .useClass(FakeExecutor)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const company = await prisma.company.create({ data: { name: "E2E Co", slug: `e2e-co-${Date.now()}` } });
    companyId = company.id;
    base = `/api/v1/companies/${companyId}/workforce`;
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  it("lists the role catalog without internal prompts", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/workforce/catalog").expect(200);

    expect(res.body.map((r: { key: string }) => r.key)).toContain("finance-clerk");
    expect(res.body[0].prompt).toBeUndefined();
  });

  it("hires a worker, auto-completes small tasks, and escalates large ones to a human", async () => {
    const server = app.getHttpServer();
    const worker = await request(server)
      .post(`${base}/workers`)
      .send({ roleKey: "finance-clerk", name: "Ava", approvalPolicy: { autoApproveMaxAmount: 500 } })
      .expect(201);
    expect(worker.body.approvalPolicy.autoApproveMaxAmount).toBe(500);

    const small = await request(server)
      .post(`${base}/workers/${worker.body.id}/tasks`)
      .send({ type: "process-invoice", title: "INV-1", input: { total: 120 } })
      .expect(201);
    const smallDone = await waitForStatus(app, `${base}/tasks/${small.body.id}`, ["COMPLETED"]);
    expect(smallDone.events.map((e: { type: string }) => e.type)).toEqual(["created", "completed"]);

    const large = await request(server)
      .post(`${base}/workers/${worker.body.id}/tasks`)
      .send({ type: "process-invoice", title: "INV-2", input: { total: 9_000 } })
      .expect(201);
    await waitForStatus(app, `${base}/tasks/${large.body.id}`, ["AWAITING_APPROVAL"]);

    const queue = await request(server).get(`${base}/approvals`).expect(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0].riskLevel).toBe("CRITICAL");

    await request(server)
      .post(`${base}/approvals/${queue.body.items[0].id}/approve`)
      .send({ note: "Verified with vendor" })
      .expect(200);
    await request(server).post(`${base}/approvals/${queue.body.items[0].id}/reject`).send({}).expect(409);
    const largeDone = await request(server).get(`${base}/tasks/${large.body.id}`).expect(200);
    expect(largeDone.body.status).toBe("COMPLETED");

    const metrics = await request(server).get(`${base}/metrics`).expect(200);
    expect(metrics.body.tasks.COMPLETED).toBe(2);
    expect(metrics.body.automationRate).toBe(0.5);
    expect(metrics.body.pendingApprovals).toBe(0);
  });

  it("rejects task types the worker's role doesn't handle", async () => {
    const worker = await request(app.getHttpServer())
      .post(`${base}/workers`)
      .send({ roleKey: "document-processor" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${base}/workers/${worker.body.id}/tasks`)
      .send({ type: "process-invoice", title: "Wrong", input: {} })
      .expect(400);
  });

  it("holds tasks while a worker is paused and cancels them on retirement", async () => {
    const server = app.getHttpServer();
    const worker = await request(server).post(`${base}/workers`).send({ roleKey: "hr-assistant" }).expect(201);
    await request(server).post(`${base}/workers/${worker.body.id}/pause`).expect(200);

    const task = await request(server)
      .post(`${base}/workers/${worker.body.id}/tasks`)
      .send({ type: "answer-policy-question", title: "PTO carry-over?", input: { question: "Can I carry over PTO?" } })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await request(server).get(`${base}/tasks/${task.body.id}`)).body.status).toBe("QUEUED");

    await request(server).post(`${base}/workers/${worker.body.id}/retire`).expect(200);
    expect((await request(server).get(`${base}/tasks/${task.body.id}`)).body.status).toBe("CANCELLED");
  });

  it("returns 404 for an unknown company", async () => {
    await request(app.getHttpServer()).get("/api/v1/companies/nope/workforce/workers").expect(404);
  });
});
