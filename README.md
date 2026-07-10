# TalentHub AI

An AI-powered employment platform connecting job seekers, employers, recruiters, HR managers,
universities, and government organizations. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full
system design, database schema, folder structure, API design, auth flow, and roadmap.

## Stack

- **Web**: Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn-style UI, Framer Motion
- **API**: NestJS, PostgreSQL, Prisma, Redis, Socket.io
- **Monorepo**: pnpm workspaces + Turborepo

## Getting started

```bash
pnpm install
cp .env.example .env      # fill in secrets before running anything that needs them
pnpm docker:up             # starts Postgres + Redis
pnpm db:generate
pnpm db:migrate             # creates the initial migration from prisma/schema.prisma
pnpm dev                    # runs web (:3000) and api (:4000) in parallel
```

- Web: http://localhost:3000
- API: http://localhost:4000/api
- API docs (Swagger): http://localhost:4000/api/docs
- Health check: http://localhost:4000/api/health

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run all apps in dev mode |
| `pnpm build` | Build all apps/packages |
| `pnpm lint` | Lint all apps/packages |
| `pnpm typecheck` | Type-check all apps/packages |
| `pnpm test` | Run all test suites |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:migrate` | Run a dev migration |

## Project structure

```
apps/web        Next.js frontend
apps/api        NestJS backend
packages/database  Prisma schema + client, shared by both apps
packages/config     Shared TypeScript config
```

## Status

Foundation module complete: monorepo tooling, full Prisma schema, NestJS bootstrap (config
validation, health check, Swagger, security middleware), Next.js shell with dark/light theming and
the public landing page, and CI. See the Roadmap section in `ARCHITECTURE.md` for what's next.
