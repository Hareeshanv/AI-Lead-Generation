# 🤖 AI Lead Generation Engine

An enterprise-grade autonomous AI system designed for finding, enriching, verifying, scoring, and engaging sales leads at scale.

---

## 📁 Repository Structure

```
ai-lead-generation/
│
├── apps/                        # Primary Applications
│   ├── web/                     # Next.js Frontend Application
│   ├── admin/                   # Admin Dashboard
│   ├── api/                     # Central Backend API Service
│   └── docs/                    # Internal Technical Documentation
│
├── packages/                    # Shared Workspaces & Core Libraries
│   ├── ui/                      # Shared UI Component Library
│   ├── database/                # Database Client, Schema & Migrations
│   ├── auth/                    # Authentication & Authorization Module
│   ├── ai/                      # Core AI Models & Orchestrator Engine
│   ├── prompts/                 # Prompt Engineering Templates & Registry
│   ├── types/                   # Shared TypeScript Interfaces & Types
│   ├── config/                  # Shared Workspace Configuration & Constants
│   ├── logger/                  # Structured Telemetry & Logging Package
│   └── shared/                  # Common Helper Utilities
│
├── agents/                      # Specialized AI Agents
│   ├── planner/                 # Lead Generation Strategy Planner
│   ├── search/                  # Multi-engine Lead Search Agent
│   ├── crawler/                 # Web Scraping & Crawling Agent
│   ├── extractor/               # Unstructured to Structured Data Extractor
│   ├── enrichment/              # Business & Contact Information Enriched
│   ├── verifier/                # Email/Phone Verification Agent
│   ├── deduplication/           # Entity Matching & Deduplication
│   ├── scoring/                 # Ideal Customer Profile (ICP) Scorer
│   ├── outreach/                # Cold Outreach Email Generator
│   ├── crm/                     # CRM Synchronization Agent
│   ├── report/                  # Intelligence & Analytics Report Generator
│   ├── analytics/               # System Performance & ROI Tracker
│   ├── scheduler/               # Agent Lifecycle & Task Scheduler
│   └── orchestrator/            # Master Multi-Agent System Orchestrator
│
├── workflows/                   # Automated Orchestration Workflows
│   ├── find-leads/              # End-to-end Lead Discovery Pipeline
│   ├── enrich-company/          # Deep Company Intelligence Gathering
│   ├── verify-contact/          # Multi-step Verification Workflow
│   ├── score-lead/              # Lead Scoring Pipeline
│   ├── send-email/              # Smart Outreach Delivery Flow
│   ├── followup/                # Dynamic Follow-up Sequence
│   └── daily-sync/              # Periodic CRM & Data Sync Workflow
│
├── services/                    # Core Infrastructure & Vendor Services
│   ├── openai/                  # LLM Service Client
│   ├── search/                  # Web Search API Service
│   ├── browser/                 # Headless Browser Fleet Manager
│   ├── email/                   # SMTP & Email Provider Interface
│   ├── storage/                 # Object Storage Manager (S3 / MinIO)
│   ├── queue/                   # Background Task Queue (BullMQ / Redis)
│   ├── scraper/                 # Proxy Scraper Service
│   ├── vector/                  # Vector DB Client (Embeddings & Semantic Search)
│   ├── analytics/               # Metrics Collector Service
│   └── crm/                     # Unified CRM Abstraction Layer
│
├── database/                    # Database Infrastructure
│   ├── migrations/              # Database Schema Migrations
│   ├── schema/                  # Database Schema Definitions
│   ├── seeds/                   # Seed Data Scripts
│   ├── functions/               # Database Stored Procedures & Triggers
│   └── views/                   # Analytical Views
│
├── jobs/                        # Asynchronous Background Processing Jobs
│   ├── crawl-job/               # Web Crawling Worker Job
│   ├── scoring-job/             # Batch Lead Scoring Worker Job
│   ├── email-job/               # Email Queue Worker Job
│   ├── cleanup-job/             # System Maintenance & Retention Job
│   ├── retry-job/               # Failed Execution Retry Handler
│   └── scheduler/               # Cron Schedule Executor
│
├── integrations/                # 3rd Party Connectors
│   ├── google/                  # Google Workspace / Search APIs
│   ├── microsoft/               # Microsoft Graph & Outlook
│   ├── slack/                   # Slack Alerts & Notifications
│   ├── hubspot/                 # HubSpot CRM Connector
│   ├── salesforce/              # Salesforce CRM Connector
│   ├── zapier/                  # Zapier Webhook Integration
│   └── webhooks/                # Inbound/Outbound Webhooks
│
├── storage/                     # Data Storage Directories
│   ├── uploads/                 # File Upload Storage
│   ├── reports/                 # Generated PDF/CSV Reports
│   ├── exports/                 # Data Export Files
│   ├── screenshots/             # Web Crawl Screenshots
│   └── cache/                   # Local Storage Cache
│
├── monitoring/                  # Observability & Monitoring
│   ├── metrics/                 # Prometheus / Custom Metrics
│   ├── logs/                    # Centralized Log Configurations
│   ├── tracing/                 # OpenTelemetry Tracing Setup
│   └── alerts/                  # Alert Rules & Thresholds
│
├── infrastructure/              # Deployment & DevOps Infrastructure
│   ├── docker/                  # Dockerfiles & Image Specifications
│   ├── kubernetes/              # Kubernetes Helm Charts & Manifests
│   ├── nginx/                   # Reverse Proxy & Load Balancer Configs
│   ├── terraform/               # Infrastructure as Code (IaC)
│   └── cloud/                   # Cloud Provider Deploy Scripts
│
├── tests/                       # Automated Test Suites
│   ├── unit/                    # Unit Tests
│   ├── integration/             # Component Integration Tests
│   ├── api/                     # API Endpoint Tests
│   ├── agents/                  # AI Agent Behavioral Tests
│   └── e2e/                     # End-to-End User Flow Tests
│
└── scripts/                     # Operational & Maintenance Scripts
    ├── setup/                   # Environment Setup Scripts
    ├── migrate/                 # DB Migration Execution Scripts
    ├── seed/                    # Database Seeding Scripts
    ├── deploy/                  # Production Build & Deploy Scripts
    └── backup/                  # Database & Storage Backup Scripts
```

---

## 🛠 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) `>= 18.0.0`
- [pnpm](https://pnpm.io/) `>= 8.0.0`
- [Docker & Docker Compose](https://www.docker.com/)

### Installation & Run

1. **Install workspace dependencies**:
   ```bash
   pnpm install
   ```

2. **Set up local environment file**:
   ```bash
   cp .env.example .env
   ```

3. **Start infrastructure services (PostgreSQL + pgvector, Redis, MinIO storage)**:
   ```bash
   docker-compose up -d
   ```

4. **Launch development servers across all apps**:
   ```bash
   pnpm dev
   ```

---

## Setup & run

### Environment variables

Copy `.env.example` to `.env` (repo root; the API and web app both read it). Required:

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | API | Service role key is secret; never expose it to the browser. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web | Public anon key. |
| `NEXT_PUBLIC_API_URL` | Web | e.g. `http://localhost:4000/api`. |
| `WEB_APP_URL` | API | Base for invite / reset-password links and OAuth redirects. |
| `API_PUBLIC_URL` | API | Public API URL (unsubscribe links, provider webhooks). |

Optional (each feature returns `422 NOT_CONFIGURED` until set, or configure per workspace under **Integrations**): `RESEND_*` (email), `WHATSAPP_*`, `META_*` (lead ads), `SARVAM_*`, `SERPER_API_KEY`, `GROQ_API_KEY`, `SLACK_WEBHOOK_URL`, `OUTBOUND_WEBHOOK_URL`/`OUTBOUND_WEBHOOK_SECRET`, `CAMPAIGN_UNSUBSCRIBE_SECRET`.

Outbound URLs (Slack, outbound webhook, workflow webhook actions) must be `https` and resolve to public addresses; private, loopback, link-local, CGNAT, multicast and cloud-metadata hosts are rejected when saving and again when sending. Slack URLs must be on `hooks.slack.com`.

### Database (Supabase)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push            # applies supabase/migrations to the linked project
```

Local development instead: `npx supabase start` (Docker), then `npx supabase db reset` (local only; wipes local data) and use the printed local URL/keys in `.env`.

### Edge function (Meta / Google lead forms)

```bash
npx supabase functions deploy lead-webhook --no-verify-jwt
npx supabase secrets set META_APP_SECRET=... META_VERIFY_TOKEN=...
```

Leads the function inserts queue a `lead.ingested` job (DB trigger); the API's job runner scores them and fires `lead.created` workflows/notifications, so the API must be running for that to happen.

### Auth redirect URLs

In Supabase → Authentication → URL Configuration set **Site URL** to `WEB_APP_URL` and add to **Redirect URLs**:
`<WEB_APP_URL>/auth/callback`, `<WEB_APP_URL>/reset-password` (password resets and invites). For Meta lead ads also register `META_REDIRECT_URI` (`<API_PUBLIC_URL>/api/integrations/meta/callback`) in the Meta app.

Invited users appear as **Pending** in Settings → Members (admins can *Resend invite* or *Revoke*) until they set a password / first sign in; pending members cannot be assigned as owners.

### Default workspace placeholder

Migration `0009` moves pre-auth data into the **Default Workspace** (`00000000-0000-0000-0000-000000000001`). The first account that signs up claims it as admin. The test setups (`tests/api`, `tests/e2e`) create a placeholder owner `default-workspace-owner@example.com` on a *local* stack when that workspace has no members, so test users get their own workspaces. This is intentional; on a real project, sign up your own admin account first.

### Run

```bash
pnpm install
pnpm --filter @ai-lead-gen/api dev     # API on PORT (default 4000)
pnpm --filter @ai-lead-gen/web dev     # web on http://localhost:3000
```

### Tests

```bash
cd tests
pnpm test:unit                  # Vitest unit tests (no services needed)
npx supabase start              # API + e2e suites need a Supabase stack (local by default)
pnpm test:api                   # Vitest + supertest against the API and local Supabase
pnpm test:e2e                   # Playwright; starts API on 4011 and web on 3011
pnpm typecheck
```
