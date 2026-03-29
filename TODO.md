# Project Roadmap & Task Tracking

This file tracks the progress of the **mony** project.

## Core Foundation

- [x] Backend scaffolding (Rust/Axum)
- [x] Database scaffolding (PostgreSQL)
- [x] Initial ADRs (Tech Stack, Schema, Invariants)
- [x] Project health & readiness endpoints
- [x] Base database schema (import_batch, import_row, ledger_transaction)

## Backend Development

### Ingestion & Normalization
- [ ] Define internal transaction normalization logic (ADR 0003)
- [x] CSV Parsing library integration (e.g., `csv` crate)
- [x] Endpoint: `POST /v1/imports` (File upload)
- [/] Logic: Deduplication and idempotent imports (Duplicate file check implemented)
- [ ] Logic: Background processing for large imports (optional for MVP)

### Transaction Management
- [ ] Endpoint: `GET /v1/transactions` (List/Filter transactions)
- [ ] Endpoint: `GET /v1/transactions/:id` (Transaction details)
- [ ] Endpoint: `PATCH /v1/transactions/:id` (Update category/metadata)

### Categories & Analytics
- [ ] Initial set of system categories
- [ ] Endpoint: `GET /v1/analytics/spending-by-category`
- [ ] Simple auto-categorization based on description patterns

## Frontend Development

- [ ] React/Vite/TypeScript scaffolding
- [ ] Shared components (Layout, UI primitives)
- [ ] Dashboard View: Recent transactions summary
- [ ] Transactions View: Paginated list with filtering
- [ ] Import View: CSV upload and batch status tracking
- [ ] Analytics View: Basic charts (Spending by category)

## Infrastructure & DX

- [ ] Makefile improvements (build, lint, test)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Docker production build optimization
- [ ] Documentation for self-hosting (Docker Compose)
