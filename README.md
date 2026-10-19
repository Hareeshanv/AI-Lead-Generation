# AI Lead Generation

Multi-tenant B2B lead discovery, scoring, outreach and CRM. Workspaces find prospects with a discovery agent (Serper web + Google Places search, classified and scored by Sarvam), ingest leads from Meta / Google lead-form ads, score them, run email / WhatsApp campaigns and automation workflows, and track deals in a pipeline.

TypeScript everywhere, in a pnpm + Turborepo monorepo. Supabase provides Postgres, Auth and an edge function. There is no Redis or separate worker: background work runs on a Postgres-backed job queue inside the API process.

## Architecture

```
apps/
  api/          Express API (port 4000) + in-process job runner
  web/          Next.js 15 App Router dashboard (port 3000)
packages/
  database/     @ai-lead-gen/database: Supabase client and org-scoped query modules
services/       Shared logic imported by the API by relative path (not workspace packages)
  discovery/    Lead Discovery Agent: Serper web/places search, Sarvam classification, dedupe, post-processing
  sarvam/       Sarvam chat-completions client (JSON-mode agent calls, token accounting)
  search/       Natural-language lead search: query parser, vocabulary, lead search
  signals/      Normalises and redacts intent signals (public posts showing buying intent)
  messaging/    Resend (email) and WhatsApp Cloud API senders
supabase/
  migrations/   SQL migrations, the source of truth for the schema (RLS, RPCs, triggers)
  functions/lead-webhook/   Deno edge function for Meta Lead Ads / Google Ads lead forms
tests/          Vitest (unit, api) and Playwright (e2e) suites
```

### API (`apps/api`)

- `src/index.ts` boots the server; `src/app.ts` builds the Express app; routes are mounted from the table in `src/routes/index.ts`. Every route is org-authenticated unless it is marked `user` (onboarding) or `public` (health, provider webhooks, OAuth callbacks).
- Domain modules: `campaigns/` (audience, scheduling, content, sending, provider webhooks), `workflows/` (schema, conditions, actions, engine), `integrations/` (per-workspace credentials, health checks, outbound webhooks), `services/crm` (deals, pipeline, tasks), `services/leads` (scoring), `agents/discovery.ts` (discovery runs), `notifications/`.
- Multi-tenancy: each authenticated request carries the caller's `org_id`, and every query and mutation is scoped by it.
- Provider credentials (Serper, Sarvam, Resend, WhatsApp, Meta, Slack, outbound webhook) are resolved per workspace by `src/integrations/credentials.ts`. Workspace secrets live in the Supabase vault. Env keys are only a fallback, used when `PLATFORM_MANAGED_PROVIDERS` allows it.
- Outbound HTTP to user-supplied URLs (Slack, outbound webhooks, workflow webhook actions) goes through `src/integrations/safeHttp.ts`. URLs must be `https` and resolve to public addresses; private, loopback, link-local, CGNAT, multicast and cloud-metadata hosts are rejected both when the URL is saved and when a request is sent. Slack URLs must be on `hooks.slack.com`.
- Logs are JSON lines on stdout/stderr (`src/logger.ts`, level from `LOG_LEVEL`).

### Job queue

Jobs are rows in the `jobs` table (migration `0012`, hardened in `0017`). `src/jobs/runner.ts` claims due jobs with a locking RPC. It runs up to `JOB_CONCURRENCY` at once per API instance, heartbeats long jobs, retries failures with exponential backoff (30s · 2^(n-1), capped at 1h), and enforces a per-type timeout. On shutdown it waits up to 25s, then puts unfinished jobs back on the queue. Several API instances can share the queue safely.

| Job type | Purpose |
|---|---|
| `agent.run` | A Lead Discovery Agent run (30 min timeout) |
| `lead.ingested` | Scores leads inserted by the edge function and fires `lead.created` (enqueued by a DB trigger) |
| `lead.rescore` | Re-scores a lead |
| `campaign.send_step` | Sends one campaign step to one recipient |
| `workflow.delayed_action` | Resumes a workflow after a delay step |
| `workflow.schedule_tick` | Cron-scheduled workflow runs |
| `integration.health_check` | Periodic provider credential checks (`INTEGRATION_HEALTH_CHECK_MINUTES`) |
| `maintenance.retention` | Deletes finished jobs and old audit-log rows (`JOB_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`) |

### Lead discovery

A discovery run (Agents page, `POST /api/discovery/run`) is queued as an `agent.run` job and supports two sources:

- **Places**: Google Places listings via Serper. Sarvam judges relevance and fit; when Sarvam fails, rule-based scores are used instead. Listings are deduplicated against existing leads by phone, email, website domain and Maps listing, then saved as leads.
- **Web**: site-scoped Google queries (Reddit, Quora, LinkedIn, YouTube, Instagram, Facebook, open web) for posts showing intent. Snippets are redacted before they go to Sarvam, and posts classified as prospective customers are saved as intent signals.

Each step is logged so the UI shows progress. A run that partly fails finishes as `completed_with_errors` rather than failing outright.

### Web (`apps/web`)

Next.js App Router with Supabase Auth (`src/lib/supabase`, `src/middleware.ts`). Data fetching uses React Query hooks in `src/hooks` (query keys in `src/hooks/queryKeys.ts`), backed by API clients in `src/services/api`. Pages: dashboard, leads, CRM pipeline, campaigns, workflows, agents (discovery), analytics, integrations, notifications, settings (workspace, members, invitations).

### Edge function (`supabase/functions/lead-webhook`)

Receives Meta Lead Ads webhooks (signature-verified) and Google Ads lead-form posts (`?source=google&source_id=<lead source>` plus the per-source key). It normalises answers in `normalize.ts` (a pure, unit-tested module) and inserts leads idempotently. The insert trigger queues `lead.ingested`, so the API must be running for those leads to be scored and for workflows to fire.

Meta apps: without a query string the platform app (`META_APP_SECRET` / `META_VERIFY_TOKEN`) is used. A workspace with its own Meta app points that app's webhook at `<function URL>?org_id=<workspace id>`; the workspace's stored Meta secret then verifies the request, and only that workspace's lead sources are used.

## Setup

Prerequisites: Node.js 20 (`.nvmrc`), pnpm 8 (`corepack enable`), and Docker if you want a local Supabase stack or the container images.

```bash
pnpm install
cp .env.example .env          # repo root; the API and web app both read it
```

### Environment variables

`.env.example` documents every variable. Required:

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | API | Service role key is secret; never expose it to the browser. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web | Public anon key. Baked into the web build. |
| `NEXT_PUBLIC_API_URL` | Web | e.g. `http://localhost:4000/api`. Baked into the web build. |
| `WEB_APP_URL` | API | Base for invite / reset-password links and OAuth redirects. |
| `API_PUBLIC_URL` | API | Public API URL (unsubscribe links, provider webhooks). |
| `CAMPAIGN_UNSUBSCRIBE_SECRET` | API | Signs unsubscribe links. Email campaigns refuse to send without it (`openssl rand -hex 32`). |

Provider credentials (each feature returns `422 NOT_CONFIGURED` until configured): workspaces save their own under **Integrations**. The env keys `SERPER_API_KEY`, `SARVAM_*`, `RESEND_*`, `WHATSAPP_*` and `META_*` are shared with workspaces that have no key of their own, but only for providers listed in:

| Variable | Default | Notes |
|---|---|---|
| `PLATFORM_MANAGED_PROVIDERS` | empty (none shared) | Comma-separated providers (`serper,sarvam,resend,whatsapp,meta`) or `*`. Slack and outbound webhooks are never shared. |
| `PLATFORM_MANAGED_ORG_IDS` | empty (all workspaces) | Restricts the shared keys to these workspace ids. |

Operations:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | API port. |
| `JOB_CONCURRENCY` | `10` | Jobs run at once per API instance. |
| `JOB_RETENTION_DAYS` | `14` | Days to keep finished jobs (`0` = keep). |
| `AUDIT_LOG_RETENTION_DAYS` | `365` | Days to keep audit-log rows (`0` = keep). |
| `INTEGRATION_HEALTH_CHECK_MINUTES` | `60` | Minimum 5. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `PUBLIC_WEBHOOK_BASE_URL` | `SUPABASE_URL` | Host of the lead-webhook function, used in the webhook URLs shown under Integrations. |
| `DEV_AUTO_LOGIN`, `NEXT_PUBLIC_DEV_AUTO_LOGIN` | `false` | Development only; ignored when `NODE_ENV=production`. |

### Database (Supabase)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push            # applies supabase/migrations to the linked project
```

Local development instead: `npx supabase start` (Docker), then `npx supabase db reset` (local only; wipes local data) and use the printed local URL/keys in `.env`.

Schema changes go in a new timestamped migration; never edit one that has been applied. Migration `0019` drops the unused mock-era `users`, `companies` and `contacts` tables. It runs without `CASCADE`, so it fails instead of silently dropping anything built on those tables outside this repo.

### Edge function

```bash
npx supabase functions deploy lead-webhook --no-verify-jwt
npx supabase secrets set META_APP_SECRET=... META_VERIFY_TOKEN=...
```

### Auth redirect URLs

In Supabase → Authentication → URL Configuration set **Site URL** to `WEB_APP_URL` and add to **Redirect URLs**:
`<WEB_APP_URL>/auth/callback**`, `<WEB_APP_URL>/reset-password**` (password resets and invites for new accounts) and `<WEB_APP_URL>/invitations/accept**` (invites for existing accounts). The `**` suffix allows the query strings the app appends. `supabase/config.toml` already lists these for local development on both `localhost:3000` and `127.0.0.1:3000`. For Meta lead ads also register `META_REDIRECT_URI` (`<API_PUBLIC_URL>/api/integrations/meta/callback`) in the Meta app.

Invited users appear as **Pending** in Settings → Members (admins can *Resend invite* or *Revoke*) until they set a password / first sign in; pending members cannot be assigned as owners.

### Default workspace placeholder

Migration `0009` moves pre-auth data into the **Default Workspace** (`00000000-0000-0000-0000-000000000001`). The first account that signs up claims it as admin. The test setups (`tests/api`, `tests/e2e`) create a placeholder owner `default-workspace-owner@example.com` on a *local* stack when that workspace has no members, so test users get their own workspaces. This is intentional; on a real project, sign up your own admin account first.

### Run

```bash
pnpm --filter @ai-lead-gen/api dev     # API on PORT (default 4000), restarts on change
pnpm --filter @ai-lead-gen/web dev     # web on http://localhost:3000
pnpm dev                               # both, via turbo
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm lint` | ESLint (flat config, `eslint.config.mjs`) over the whole repo |
| `pnpm typecheck` | `tsc --noEmit` in api, web, database and tests |
| `pnpm test` | Unit tests (no services needed) |
| `pnpm test:api` | Vitest + supertest against the API and a local Supabase stack |
| `pnpm test:e2e` | Playwright; starts the API on 4011 and web on 3011 |
| `pnpm build` | API bundle (`apps/api/dist/index.js`, esbuild) and Next.js build |
| `pnpm format` / `format:check` | Prettier (`.prettierrc.json`) |

The API and e2e suites need a Supabase database. They use `TEST_SUPABASE_URL` / `_SERVICE_ROLE_KEY` / `_ANON_KEY` when set; otherwise they use the root `.env`, or a local stack found with `npx supabase status` (start one with `npx supabase start`).

## Docker

`apps/api/Dockerfile` bundles the API, `packages/database` and `services/*` into one file with esbuild, so the runtime image ships no `node_modules`. `apps/web/Dockerfile` builds Next.js with `output: "standalone"` (enabled by `NEXT_OUTPUT=standalone`, which the Dockerfile sets). The `NEXT_PUBLIC_*` values are build arguments because Next.js inlines them at build time.

```bash
docker compose up --build    # api on :4000, web on :3000, using .env
```

The compose file targets a hosted Supabase project. With a local stack, containers cannot reach the host's `127.0.0.1`; see the comments in `docker-compose.yml`.

## CI

`.github/workflows/ci.yml` has three jobs:

- **checks**: install, lint, typecheck, unit tests, API and web builds.
- **docker**: builds both images (not pushed).
- **integration**: starts Supabase with the Supabase CLI, then runs the API and Playwright suites.

## Deploy notes

- **Shared provider keys are now opt-in.** Deployments that relied on env keys (`SERPER_API_KEY`, `SARVAM_API_KEY`, `RESEND_*`, `WHATSAPP_*`, `META_*`) for all workspaces must set `PLATFORM_MANAGED_PROVIDERS` (e.g. `*`), or every workspace must save its own keys under Integrations.
- **Email campaigns need `CAMPAIGN_UNSUBSCRIBE_SECRET`.** Without it, email sends fail as not configured.
- **Per-workspace Meta apps** point their webhook at the edge function with `?org_id=<workspace id>`. The platform app keeps using the bare URL.
- Apply migrations (`npx supabase db push`) before deploying the API, and redeploy the edge function when `supabase/functions` changes.
- Run at least one API instance at all times; it is also the job worker. Give it about 30s to stop gracefully (`stop_grace_period` in compose).

## Roadmap (not implemented)

These features are planned but do not exist in the code yet:

- Email and phone verification (deliverability / line-type checks).
- Lead enrichment from third-party data providers.
- HubSpot and Salesforce sync.
- Semantic (embedding-based) deduplication. Dedupe currently matches exact phone, email, website domain and Maps listing keys.
- LLM fallback when Sarvam is unavailable. Discovery currently falls back to rule-based scoring.
