# Project Roadmap & Task Tracking

This file tracks the progress of the **mony** project.

## Core Foundation

- [x] Backend scaffolding (Rust/Axum)
- [x] Database scaffolding (PostgreSQL)
- [x] Initial ADRs (Tech Stack, Schema, Invariants)
- [x] Project health & readiness endpoints
- [x] Base database schema (import_batch, import_row, ledger_transaction)

## Phase 1: Frontend Foundation (CRITICAL)

- [x] **(Task 1.1)** Initialize React/Vite/TypeScript in `/frontend`
- [x] **(Task 1.2)** Setup routing and base layout
- [x] **(Task 1.3)** Implement API client with TypeScript models

## Phase 2: Backend Categories & Analytics

- [x] **(Task 2.1)** Implement `GET /v1/analytics/spending-by-category`
- [x] **(Task 2.2)** Implement category management endpoints
- [x] **(Task 2.3)** Basic auto-categorization logic
- [x] Initial set of system categories

## Phase 3: Transaction Refinement

- [x] Endpoint: `GET /v1/transactions` (List/Filter transactions)
- [x] Endpoint: `GET /v1/transactions/:id` (Transaction details)
- [x] Endpoint: `PATCH /v1/transactions/:id` (Update category/metadata)
- [x] **(Task 3.1)** Improve `PATCH` for partial metadata updates
- [x] **(Task 3.2)** Advanced filtering and pagination for `GET /v1/transactions`

## Ingestion & Normalization

- [x] Define internal transaction normalization logic for the generic CSV contract
- [x] CSV Parsing library integration (e.g., `csv` crate)
- [x] Endpoint: `POST /v1/imports` (File upload)
- [x] Logic: Deduplication and idempotent imports
- [ ] Logic: Background processing for large imports (optional for MVP)

## Infrastructure & DX

- [x] Makefile improvements (build, lint, test)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Docker production build optimization
- [ ] Documentation for self-hosting (Docker Compose)
