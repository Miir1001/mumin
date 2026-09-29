# TalentHub AI — Architecture

Status: **Foundation (Module 0) implemented.** This document is the reference architecture for the
full platform. Each numbered section states the decision and why it was made. Everything below
"Roadmap" is designed but not yet built — it will land module by module, each production-ready
before the next starts.

---

## 1. System Architecture

```
                                   ┌─────────────────────────┐
                                   │      apps/web            │
                                   │  Next.js 15 (App Router) │
                                   │  Auth.js session/JWT      │
                                   └────────────┬─────────────┘
                                                │ REST (JSON) + WebSocket
                                                ▼
                                   ┌─────────────────────────┐
                    Redis  ◄───────┤       apps/api           │───────► AWS S3
              (cache, queues,      │   NestJS (modular)       │      (resumes, avatars,
               socket.io adapter,  │   REST + Socket.io        │       video, attachments)
               rate limiting)      └────────────┬─────────────┘
                                                │ Prisma ORM
                                                ▼
                                   ┌─────────────────────────┐
                                   │       PostgreSQL          │
                                   └─────────────────────────┘

        External: Stripe / PayPal (billing) · SMTP / Twilio (email, SMS) · Anthropic API (AI features)
```

**Decision: monorepo (pnpm workspaces + Turborepo), not polyrepo.**
The web app, API, and Prisma schema change together constantly (a new field touches the DB, the API
DTO, and the UI form in one PR). A monorepo keeps those changes atomic and lets `packages/database`
be the single source of truth for types shared by both apps. Turborepo gives per-package build/lint
caching so this doesn't get slow as the codebase grows.

**Decision: NestJS for the backend, not a Next.js API-route monolith.**
The spec calls for real-time chat (Socket.io), background jobs (email digests, resume parsing,
AI scoring), and a formal RBAC/module boundary per role. Nest's module system maps directly onto the
domain (`AuthModule`, `JobsModule`, `ApplicationsModule`, `BillingModule`, ...), gives first-class
DI for testability, and has mature support for queues, WebSockets gateways, and Swagger — all of
which Next.js API routes would require bolting on ad hoc.

**Decision: separate web and api processes, not a single Next.js "full-stack" app.**
Employers, recruiters, and government/university back-office work is API-heavy (bulk operations,
webhooks, scheduled jobs) and benefits from independent scaling and deploys from the marketing/job-
seeker-facing frontend. It also lets mobile clients or a future public API consume the same backend.

**Decision: Redis from day one.**
Used for: Socket.io's adapter (multi-instance real-time chat), rate limiting (`@nestjs/throttler`),
job queues (BullMQ, for resume parsing / AI scoring / email sending), and hot-path caching (job
search facets, session lookups).

---

## 2. Database Design

`packages/database/prisma/schema.prisma` is implemented and generates cleanly. Highlights:

- **Identity**: `User` (role enum: `SUPER_ADMIN, EMPLOYER, RECRUITER, HR_MANAGER, JOB_SEEKER,
  UNIVERSITY, GOVERNMENT`) + `Account` (OAuth links) + `Session` + `RefreshToken` + `OtpCode`
  (email/phone verification, login OTP, 2FA, password reset — one table, discriminated by
  `OtpPurpose` rather than four near-identical tables).
- **Job seeker domain**: `JobSeekerProfile` is the 1:1 hub for `Education`, `Experience`,
  `Certificate`, `ProfileSkill`/`Skill` (global skill taxonomy, many-to-many with proficiency),
  `ProfileLanguage`/`Language`, `Project`, `Reference`, `Resume` (versioned, `AI_GENERATED` /
  `PARSED` / `UPLOADED`), `CoverLetter`, `VideoResume`, plus `SavedJob` and `JobAlert` off `User`
  directly (they're search/notification state, not profile content).
- **Employer domain**: `Company` (typed via `CompanyType` so the same model serves employers,
  universities, government bodies, and training centers — they share almost every field, and
  splitting them would fragment search/verification/billing logic for no benefit) → `CompanyMember`
  (role-scoped membership) → `Job` → `JobApplication`. `PipelineStage` is per-job and ordered, so
  each employer can define their own ATS pipeline instead of a hardcoded status list.
- **ATS extras**: `ApplicationNote`, `ApplicationTag`/`ApplicationTagOnApplication`, `TalentPool`,
  `EmailTemplate`, `Interview`/`InterviewFeedback`, `Offer` — each a thin join or child table off
  `JobApplication` so the pipeline stays queryable from one root.
- **Communication**: `Conversation`/`ConversationParticipant`/`Message` supports 1:1 and group
  threads (interview scheduling, recruiter outreach) without a separate schema for each.
- **Learning**: `Course`/`Enrollment`, with `Certificate.courseId` optionally linking a job seeker's
  certificate back to a completed course — this is how university/training-center course completion
  becomes a verifiable credential on a profile.
- **Billing**: `Plan` → `Subscription` (owned by a `User` *or* a `Company`, provider-agnostic via
  `PaymentProvider` enum so Stripe and PayPal share one model) → `Invoice` → `Payment`, plus
  standalone `Coupon`.
- **AI Workforce**: `AiWorker` (a hired AI worker, owned by a `Company`, keyed to a role in the
  code-defined catalog, with a per-worker `approvalPolicy` JSON) → `AiTask` (one unit of work, with
  structured `output`, `confidence`, `riskLevel`, `amount`, token usage) → `ApprovalRequest` (a
  human decision the task is waiting on) and `AiTaskEvent` (append-only timeline/audit trail).
  `AiTask.companyId` is denormalized so company-wide queues and metrics don't need a join. See
  section 8.
- **Trust & ops**: `Report` (polymorphic via `ReportTargetType` + `targetId` — avoids a table per
  reportable entity), `AuditLog` (append-only, indexed by entity), `SupportTicket`/
  `SupportTicketMessage`.

All IDs are `cuid()`. Soft-delete (`deletedAt`) is used only where hard-deleting would break
referential history that must survive for legal/audit reasons (`User`, `Company`, `Job`); everything
else cascades on delete because it's genuinely owned child data.

---

## 3. Folder Structure

```
talenthub-ai/
├── apps/
│   ├── web/                     # Next.js 15 frontend (implemented: shell + landing page)
│   │   ├── app/                 # App Router: route groups per role dashboard go here
│   │   ├── components/          # ui/ (shadcn primitives) + feature components
│   │   └── lib/                 # client utilities, API client, auth config
│   └── api/                     # NestJS backend (implemented: bootstrap + health)
│       ├── src/
│       │   ├── config/          # env validation (zod) + typed configuration
│       │   ├── common/          # filters, interceptors, guards, decorators, pipes
│       │   ├── prisma/          # PrismaService (wraps @talenthub/database)
│       │   ├── health/          # liveness/readiness endpoint
│       │   └── <domain>/        # one Nest module per bounded context, added as built:
│       │                        #   auth/ users/ profiles/ companies/ jobs/ applications/
│       │                        #   interviews/ messaging/ notifications/ billing/ admin/ ai/
│       └── test/                # e2e specs (supertest)
├── packages/
│   ├── database/                # Prisma schema + generated client (implemented)
│   └── config/                  # shared tsconfig base (implemented); eslint presets as needed
├── docker-compose.yml           # Postgres + Redis for local dev (implemented)
└── .github/workflows/ci.yml     # lint, typecheck, test, build on every push (implemented)
```

**Decision: one Nest module per bounded context, not a layered `controllers/ services/ folder`
split.** Each domain module owns its controller, service, DTOs, and tests together, so a module is
independently reviewable and (later) extractable into its own deployable if the platform needs to
split the monolith. `common/` holds only cross-cutting concerns (auth guards, exception filters) —
nothing domain-specific lives there.

**Decision: role-based route groups in `app/`, not role-based subdomains.** Next.js route groups
(`app/(job-seeker)/...`, `app/(employer)/...`, `app/(admin)/...`) share the App Router's layout
nesting so each role gets its own nav/shell while still sharing the design system and auth session.

---

## 4. API Design

- **REST, versioned via URI (`/api/v1/...`)**, documented with Swagger/OpenAPI
  (`/api/docs` — already live in the implemented bootstrap). Real-time features (chat, live
  notification pushes, live interview status) go over Socket.io namespaces (`/ws/chat`,
  `/ws/notifications`), not REST polling.
- **Every module follows Controller → Service → Repository-via-Prisma**, with `class-validator` DTOs
  at the controller boundary (global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` is
  already wired in `main.ts`) and Swagger decorators on every DTO so the docs never drift from the
  code.
- **Global cross-cutting pieces already in place**: `HttpExceptionFilter` (uniform error shape),
  `LoggingInterceptor` (structured request logs), `ThrottlerGuard` (rate limiting, 100 req/min
  default, tightened per-route for auth endpoints once `AuthModule` lands), `helmet()`, CORS scoped
  to `CORS_ORIGIN`.
- **Pagination**: cursor-based on list endpoints backed by high-growth tables (`Job`,
  `JobApplication`, `Message`) to stay performant past page 1000; offset-based (`skip/take`) is fine
  for small, bounded lists (a company's own `PipelineStage`s).
- **Idempotency**: mutating endpoints that can be safely retried by a client (offer send, payment
  webhook handlers) accept an `Idempotency-Key` header once `BillingModule`/webhooks land.

---

## 5. Authentication & Authorization Flow

```
Web (Auth.js)                          API (NestJS)
──────────────                         ─────────────
Credentials / Google / Microsoft /     JWT access token (15m) issued on
LinkedIn / Email+OTP  ──────────────►  successful auth, short-lived, signed
                                        with JWT_ACCESS_SECRET
                                        Refresh token (7d) stored hashed in
                                        `RefreshToken`, rotated on every use,
                                        revocable (logout / "sign out all
                                        devices")
2FA (TOTP) checked as a second step   `OtpCode` table (purpose = TWO_FACTOR)
before a session is issued when        gates session issuance
`user.twoFactorEnabled`
```

- **Auth.js on the frontend** handles the OAuth dance (Google, Microsoft, LinkedIn) and email/OTP
  sign-in, using the Prisma adapter against the `Account`/`Session` tables already in the schema —
  so OAuth-linked accounts and password/OTP accounts are the same `User` row, not separate identities
  that need merging later.
- **The API never trusts the browser session directly.** After Auth.js establishes identity, the web
  app exchanges it for the API's own short-lived JWT + refresh token pair, because the API also needs
  to serve non-browser clients (future mobile app, partner integrations) without depending on
  Auth.js's cookie session.
- **RBAC** is enforced with a `RolesGuard` + `@Roles(...)` decorator reading `UserRole` off the JWT
  claims, plus a resource-level check where needed (e.g. a `RECRUITER` can only act on applications
  belonging to a company they're a `CompanyMember` of — checked in the service layer, not just the
  route).
- **2FA**: TOTP-based (compatible with any authenticator app), stored as `twoFactorSecret` on `User`;
  enabling it is opt-in per user, enforceable as mandatory per role via a `SUPER_ADMIN`-configurable
  policy (admin/finance roles first).
- **Rate limiting** on auth endpoints specifically (stricter than the platform default) to blunt
  credential-stuffing and OTP-brute-force once `AuthModule` is built.

---

## 6. UI/UX Pages (by role)

Implemented: **public landing page** (`apps/web/app/page.tsx`) — nav, hero, role grid, AI feature
grid, CTA, footer; dark/light mode via `next-themes`; glassmorphic nav; Framer Motion scroll-in
animations; shadcn-style `Button` primitive with CVA variants.

Planned, one route group per role, each behind its own layout/nav:

| Role | Core pages |
|---|---|
| Job Seeker | Dashboard, Profile/Resume builder, Job search, Saved jobs & alerts, Applications tracker, Interviews, Messages, Settings |
| Employer / HR Manager | Company profile & career page, Job postings, Candidate pipeline (Kanban), Interview scheduling, Offers, Analytics, Team & billing |
| Recruiter | Candidate search, Talent pools, Pipeline, Bulk messaging & templates, Reports |
| University / Government | Org profile, Course/program management, Graduate placement dashboard, Partner job board |
| Super Admin | User/company management, Content moderation queue, Payments & subscriptions, Audit logs, Support tickets |

**Design direction (implemented in the landing page, to be reused everywhere):** neutral base
palette with a single indigo/violet accent (`hsl(var(--primary))`), CSS-variable theme tokens so
dark mode is a class toggle rather than duplicated styles, generous whitespace, restrained motion
(200–500ms ease-out fades/slides on scroll, nothing looping or attention-grabbing), and glass surfaces
reserved for chrome (nav) rather than content cards, so content stays readable.

---

## 7. Security (designed, implemented incrementally)

- **JWT** access/refresh pair as above; secrets validated at boot (`env.validation.ts` — the app
  refuses to start with a weak or missing secret, already enforced).
- **RBAC** via guard + decorator (above); **OAuth** via Auth.js providers.
- **Rate limiting** via `@nestjs/throttler`, already applied globally.
- **Encryption**: TLS everywhere in transit; secrets via environment/secret manager, never
  committed (`.env.example` documents required vars with no real values); password hashes via
  argon2id when `AuthModule` lands; PII fields that don't need to be queried (e.g. raw parsed resume
  text) encrypted at rest.
- **Secure file upload**: direct-to-S3 via presigned URLs (server issues a scoped, short-lived PUT
  URL; the API never proxies file bytes), server-side MIME/type validation before issuing the URL,
  virus scanning hook on S3 event for resumes/attachments.
- **Audit logs**: `AuditLog` table, written by a Nest interceptor on sensitive mutations
  (role changes, payment actions, moderation actions).
- **GDPR readiness**: `deletedAt` soft-delete plus a hard-delete/export job for "right to be
  forgotten" and data portability requests, scoped by `userId` across every owned table.

---

## 8. AI Workforce (implemented)

Organizations — businesses and government bodies — "hire" AI workers instead of adding headcount
for repetitive administrative and professional work. Each worker runs tasks around the clock, and any
outcome that trips the organization's guardrails is held for a human to approve.

```
POST /workers/:id/tasks ─► AiTask QUEUED ─► TaskQueueService (priority, bounded concurrency)
                                                 │
                                                 ▼
                                   TaskRunnerService.run(taskId)
                          atomic claim (QUEUED→RUNNING, worker ACTIVE only)
                                                 │
                                   AiExecutor (Claude, structured output)
                                                 │
                                   evaluateApproval(policy, outcome)
                        ┌────────────────────────┴───────────────────────┐
                   passes policy                                   trips a rule
               AiTask COMPLETED                          AiTask AWAITING_APPROVAL
                                                         + ApprovalRequest PENDING
                                                                   │
                                                  human approves ─┴─ human rejects
                                                  → COMPLETED          → REJECTED
```

**Decision: the role catalog lives in code (`apps/api/src/workforce/catalog`), not the database.**
A role is a prompt, a set of task types, default guardrails, and pricing/economics. Prompts and
guardrails are logic: they need review, tests, and versioning with the code that interprets them.
Workers store only `roleKey` plus their own overrides. Roles shipped: HR Assistant, Procurement
Officer, Finance Clerk, Customer Service Agent, Document Processor, Project Coordinator.

**Decision: one structured output contract for every worker.** Every task returns `summary`,
`details`, `draft`, `proposedAction {type, description, amount}`, `confidence`, `riskLevel`,
`riskFactors`, `needsHumanReview`, enforced by the Claude API's structured outputs (zod schema).
That's what lets a single, testable policy engine govern every department, and gives reviewers a
consistent approval queue.

**Decision: approval policy is a pure function (`policy/approval-policy.ts`).** A task goes to a
human if *any* rule trips: the task type always needs sign-off (e.g. offer letters), the
organization opted that task type in, the amount exceeds `autoApproveMaxAmount`, confidence is
below `minConfidence`, the assessed risk meets `approvalRiskThreshold`, or the worker itself asked
for review. The reported risk is the highest any rule implies (amounts ≥10× the limit are
CRITICAL), so the queue sorts riskiest-first. A worker's proposed action is never treated as done
until the policy or a human releases it.

**Decision: the database row is the source of truth for task state; the queue is in-process for
now.** The runner claims tasks with a conditional `updateMany` (so double-dispatch is harmless),
transient AI failures retry with backoff up to 3 attempts, and on boot `RUNNING` tasks are
recovered to `QUEUED`. That recovery assumes one API instance; for horizontal scaling
`TaskQueueService` is swapped for a BullMQ queue on the existing Redis without touching the runner.

**AI provider**: `AnthropicExecutor` calls Claude via `@anthropic-ai/sdk` (`ANTHROPIC_MODEL`, default
`claude-opus-5-5`) with structured outputs, prompt caching on the per-role system prompt, and
server-side refusal fallbacks. Task input is framed as data, not instructions, to blunt prompt
injection from customer-supplied documents. Without credentials the API still boots; tasks fail
with a clear error. The executor sits behind the `AI_EXECUTOR` token, so tests (and future
providers) substitute it.

**API** (all under `/api/v1`):

| Method & path | Purpose |
|---|---|
| `GET /workforce/catalog` | Hireable roles, task types, default policy, pricing |
| `POST/GET /companies/:companyId/workforce/workers` | Hire / list workers |
| `GET/PATCH …/workers/:workerId` | Detail / rename, instructions, policy overrides |
| `POST …/workers/:workerId/{pause,resume,retire}` | Lifecycle (retire cancels open tasks) |
| `POST …/workers/:workerId/tasks` | Assign a task (processed asynchronously) |
| `GET …/tasks`, `GET …/tasks/:taskId` | Cursor-paginated list / detail with timeline |
| `POST …/tasks/:taskId/{cancel,retry}` | Cancel queued or awaiting work / retry failed |
| `GET …/approvals` | Human approval queue (pending, riskiest first) |
| `POST …/approvals/:approvalId/{approve,reject}` | Record a decision |
| `GET …/metrics?days=30` | Tasks by status, automation rate, hours saved, net savings |

**Not yet done**: company-scoped routes check that the company exists but not who is calling;
they get `RolesGuard` + `CompanyMember` checks (and `decidedBy`/`hiredBy`/`requestedBy` actor
IDs) when the Auth module lands. A workforce dashboard in `apps/web` and connectors that execute
approved actions in external systems (ERP, HRIS, ticketing) come after that.

---

## Roadmap (module by module)

0. **Foundation — done.** Monorepo, Prisma schema, NestJS bootstrap (config validation, health
   check, Swagger, security middleware, rate limiting), Next.js 15 shell with theming and landing
   page, CI pipeline.
1. **Auth module** — registration, login, OAuth providers, email/phone OTP, 2FA, JWT issuance/
   rotation, RBAC guards. Everything else depends on this.
2. **Job Seeker profile module** — profile CRUD, education/experience/skills, resume upload +
   AI parsing.
3. **Employer & Jobs module** — company profiles, job postings, public job search/filtering.
4. **Applications & ATS module** — apply flow, pipeline stages, notes/tags, recruiter views.
5. **Interviews, Messaging, Notifications** — scheduling, real-time chat, in-app/email/push
   notifications.
6. **AI features** — resume scoring/ATS optimization, job/candidate matching, interview coach,
   cover letter generation (built on top of, not before, the data that feeds them).
7. **Billing & Admin** — Stripe/PayPal subscriptions, invoices, coupons, the super admin panel.
8. **AI Workforce — backend done** (section 8). Remaining: auth guards once Module 1 lands, the
   workforce dashboard (workers, task queue, approval inbox, savings), BullMQ-backed queue, and
   connectors that execute approved actions in customer systems.

Each module ships with its own tests (unit + e2e), Swagger docs, and no placeholder endpoints —
built in this order because each one is a hard dependency of the next.
