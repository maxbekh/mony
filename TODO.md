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
- [x] **First POC: Full flow from CSV import to Dashboard visualization**
- [ ] Logic: Background processing for large imports (optional for MVP)

## Next Product Slices

- [x] Import management: list imports with source metadata and support deletion flows
- [x] Import management: define deletion semantics for batches and related transactions
- [x] Transaction editing: support category and description management with clear validation rules
- [x] Dashboard: add selectable periods for summary views
- [x] Product/UI: separate dashboard summaries from deeper analytics flows
- [x] Transactions UX: add faster categorization and better sort/filter controls
- [x] Intelligent categorization: inspect current database categories and correct weak tags first
- [x] Intelligent categorization: derive stronger local rules from normalized descriptions, source metadata, and recurring patterns
- [ ] Intelligent categorization: learn from confirmed historical categorizations already stored in the database
- [ ] Intelligent categorization: add optional AI suggestions only for unresolved or low-confidence cases
- [x] Implement auth foundation: bootstrap admin, JWT access tokens, refresh token rotation, session audit, and protected web/API flows
- [x] Product/UI: add system-aware dark mode with explicit light/dark override support
- [x] Product/UI: rename Account to Settings and consolidate appearance, password, session, and security activity flows
- [x] Product planning: define intelligent dashboard goals, default widgets, and configurable layout principles
- [x] Product/UI: simplify overloaded mobile navigation with prioritized tabs and a secondary menu

## Phase 4: Authentication & Authorization

- [x] **(Task 4.1)** Add auth schema: users, sessions, refresh token families, and auth audit events
- [x] **(Task 4.2)** Implement bootstrap-only first user creation and password login with Argon2id
- [x] **(Task 4.3)** Issue asymmetric JWT access tokens with strict claim validation and JWKS publishing
- [x] **(Task 4.4)** Implement opaque refresh tokens with hashing, rotation, family theft detection, and session revocation
- [x] **(Task 4.5)** Protect `/v1/*` routes by default and introduce scope-aware auth extractors/middleware
- [x] **(Task 4.6)** Integrate the React web app with login, token refresh, route protection, and secure token storage rules
- [x] **(Task 4.7)** Add backend and frontend validation coverage for auth flows and protected route behavior
- [x] **(Task 4.8)** Add auth event visibility, login failure logging, and baseline auth rate limiting
- [ ] **(Task 4.9)** Replace in-memory auth throttling with a more robust persistent or distributed strategy
- [ ] **(Task 4.10)** Extend auth audit coverage and add filtering/pagination in Settings
- [ ] **(Task 4.11)** Add MFA/TOTP support and recovery code flows
- [ ] **(Task 4.12)** Prepare explicit OIDC identity mapping (`issuer` / `sub`) and provider integration boundaries

## Phase 5: Dashboard Intelligence & Personalization

- [ ] **(Task 5.1)** Add a dashboard widget model with default widgets, show/hide controls, ordering, and pinned categories
- [x] **(Task 5.2)** Add analytics endpoints for monthly time series grouped by category and optionally merchant
- [x] **(Task 5.3)** Add period comparison analytics for current vs previous equivalent window with amount and percentage deltas
- [ ] **(Task 5.4)** Detect recurring payments or subscription-like patterns with visible confidence and correction flows
- [ ] **(Task 5.5)** Add anomaly and review widgets for spikes, large transactions, and uncategorized or low-confidence items
- [ ] **(Task 5.6)** Persist per-user dashboard preferences such as widget visibility, ordering, and default period

## Notes For Upcoming Work

- New data management features should preserve financial integrity and avoid hidden rewrites.
- Authentication now targets an OAuth2/OIDC-compatible foundation with short-lived asymmetric JWT access tokens and opaque rotating refresh tokens.
- Web auth should keep access tokens in memory only and use `HttpOnly` refresh cookies with CSRF protections for refresh and logout flows.
- Categorization work should start by mining the existing database for bad tags and repeated merchant patterns before introducing new external systems.
- AI should be a last-layer suggestion mechanism, not the primary categorization source.
- Learned categorization memory derived from a real local database must remain unversioned and outside the public repository.

## Immediate Next Objectives

- Replace auth rate limiting with something durable enough for multi-process or restart-safe deployments.
- Extend auth events with more failure cases and expose filtering or pagination in Settings.
- Add frontend tests around theme preference, `/account` to `/settings` redirect, and protected auth UX.
- Define the next auth/authz layer: MFA, role or scope boundaries, and OIDC external identity mapping.
- Build a local-only categorization memory layer that learns from confirmed edits without storing personal patterns in the public repository.
- Add month-based category analytics so users can inspect trends like groceries spending over time.
- Define the first configurable dashboard slice with a strong default layout and minimal but clear personalization.

## Infrastructure & DX

- [x] Makefile improvements (build, lint, test)
- [x] CI/CD pipeline (GitHub Actions)
- [x] Docker production build optimization
- [x] Documentation for self-hosting (Docker Compose)
- [x] Dev services: manage local db/backend/frontend with restartable user services
