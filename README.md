# traverse-app

Traverse product monorepo (Phase 0). **Specs and decisions live in the
[traverse-docs](https://github.com/vasudevap/traverse-docs) repo** - this repo
implements them. Stack per Decisions D12-D22 / H9-H13: NestJS + PostgreSQL (RLS) +
pg-boss on AWS ECS Fargate; four Vite/React frontends.

| Path                                                    | What                                                     |
| ------------------------------------------------------- | -------------------------------------------------------- |
| apps/api                                                | NestJS modular-monolith REST API (D12, D18)              |
| apps/worker                                             | Generic pg-boss worker: email, retention, webhooks (D17) |
| apps/video-worker                                       | FFmpeg transcode worker (D20)                            |
| apps/admin, apps/coach, apps/client, apps/billing-admin | The four SPAs (A12)                                      |
| packages/ui                                             | Shared components + Bearing design tokens                |
| packages/api-client                                     | Typed API client shared by the SPAs                      |
| packages/db                                             | Kysely schema, migrations, RLS policies (D13-D15)        |
| packages/domain                                         | DTOs, Zod schemas, event envelopes                       |
| packages/jobs                                           | JobDispatcher interface + queue names (D17)              |
| packages/config                                         | Non-secret shared constants                              |

Dev: `corepack enable && pnpm install && pnpm verify`. Local V15 defaults are listed
in `.env.example`. Conventions: no em dashes
anywhere; one teal action per view; see traverse-docs CLAUDE.md.
