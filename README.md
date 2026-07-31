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
