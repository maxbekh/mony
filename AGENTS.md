# AI Agent Instructions

This file is the repository-wide instruction entrypoint for any AI coding assistant working on **mony**.

This policy applies to all assistants, regardless of vendor or model.

Minimum required workflow:

1. Run `git status`, `git branch`, and `git log -n 5` before starting.
2. Work on a descriptive branch, never directly on `main`.
3. Keep changes small and logically scoped.
4. Use Conventional Commits.
5. Commit completed logical changes before handover.

## Current Project State (as of 2026-04-03)

- **Backend (Rust/Axum)**: Core ingestion (CSV), transaction listing/detail/update, analytics, and static category endpoints are operational.
- **Database (PostgreSQL)**: Initial schema for imports and transactions is migrated.
- **Frontend**: React/Vite/TypeScript scaffold is present with routing, layout, and typed API client foundations.
- **Infrastructure**: Docker and Makefile exist with backend and frontend validation commands.
- **Authentication**: Auth is now an active project slice. The target is a JWT/refresh-token foundation that can evolve toward OIDC/OAuth2 without reworking core authorization boundaries.

## Roadmap & Next Steps

Agents should pick tasks from this list and **update `TODO.md`** to indicate they are working on it (e.g., by adding `(IN PROGRESS - @agent_name)`).

### Phase 1: Frontend Foundation (CRITICAL)
- **Task 1.1**: Initialize React/Vite/TypeScript in `/frontend`. Use standard styling (Vanilla CSS or simple UI library).
- **Task 1.2**: Setup routing (React Router) and base layout (Sidebar, Content area).
- **Task 1.3**: Implement a basic API client (fetch or axios) with proper types matching backend models.

### Phase 2: Backend Categories & Analytics
- **Task 2.1**: Implement `GET /v1/analytics/spending-by-category` (Aggregate `amount_minor` by `category_key`).
- **Task 2.2**: Decide on category management (static vs dynamic) and implement necessary endpoints.
- **Task 2.3**: Basic auto-categorization (regex-based rules on descriptions).

### Phase 3: Transaction Refinement
- **Task 3.1**: Improve `PATCH /v1/transactions/:id` to allow partial updates of metadata.
- **Task 3.2**: Add pagination and advanced filtering (by date range, amount, category) to `GET /v1/transactions`.

### Phase 4: Authentication & Authorization (ACTIVE)
- **Task 4.1**: Add auth schema for users, sessions, refresh token families, and auth audit events.
- **Task 4.2**: Implement bootstrap-only first-user creation and password login with Argon2id.
- **Task 4.3**: Issue short-lived asymmetric JWT access tokens and publish JWKS metadata.
- **Task 4.4**: Add opaque rotating refresh tokens with family reuse detection and session revocation.
- **Task 4.5**: Protect `/v1/*` routes by default, with explicit public auth/bootstrap exceptions and scope-aware extraction hooks.
- **Task 4.6**: Integrate the web app with login, in-memory access tokens, `HttpOnly` refresh cookies, and CSRF protection on refresh/logout.
- **Task 4.7**: Add auth-focused tests covering bootstrap, login, refresh, route protection, and revocation behavior.

## Task Coordination Protocol

1. **CLAIM**: Before starting, check `TODO.md`. If a task is not claimed, add your name next to it: `- [ ] (CLAIMED: @agent_name) Task description`.
2. **BRANCH**: Create a branch specific to the task: `feat/frontend-scaffold`.
3. **UPDATE**: Periodically update `TODO.md` with progress if the task is long.
4. **COMPLETE**: Once done, check the box `- [x] Task description` and remove your claim tag.

Current active auth branch naming convention: `feat/auth-*`.

## Core Engineering Principles

- **YAGNI**: Do not implement features or abstractions based on future "what-ifs". Only code what is required for the current task.
- **KISS**: Favor readability and simplicity over clever or "magical" code.
- **Modular Monolith**: Keep the project in a single repository but maintain clear domain boundaries.
- **No Vibe Coding**: Every architectural choice must be justified. If a complex pattern is suggested, provide a brief rationale.

## Financial Integrity and Precision

- **Integer-Only Currency**: Never use floats for money. All amounts must be stored as integers in the smallest unit (minor units like cents) or via a decimal library chosen deliberately for financial precision.
- **Immutability**: Once a transaction is recorded, prefer adjustments or reversals instead of rewriting history.
- **Atomic Operations**: Use database transactions for any operation involving multiple records to preserve consistency.

## Security Mandates

- **Zero-Trust Input**: Validate all input from frontend, CSV imports, and external systems on the backend.
- **Least Privilege**: Services such as the database user should only have the permissions they need.
- **Dependency Audit**: Evaluate maintenance status, footprint, and security track record before adding dependencies.
- **Secure Defaults**: APIs should require authentication by default unless a route is explicitly public.
- **Auth Architecture Baseline**: Prefer short-lived asymmetric JWT access tokens plus opaque rotating refresh tokens stored server-side. Avoid browser `localStorage` for credentials and keep the design compatible with a future external OIDC provider.

## Public Repository Data Rules

- **Assume Public Exposure**: Treat every commit, branch, pull request, log, screenshot, fixture, and code comment as public.
- **No Secrets**: Never commit API keys, access tokens, passwords, private certificates, OAuth credentials, `.env` files, or copied secrets from local machines.
- **No Real Financial Data**: Never commit real bank exports, transaction histories, account numbers, IBANs, card numbers, billing addresses, tax identifiers, or any personal financial records.
- **Synthetic or Irreversibly Anonymized Fixtures Only**: Test fixtures must be fully synthetic or anonymized so the original person, account, or institution cannot be recovered.
- **Sanitize Examples and Docs**: Sample payloads, screenshots, logs, and CSV examples must use fake names, fake identifiers, and fake values.
- **Stop If Unsure**: If there is any doubt about whether data is sensitive, do not commit it. Replace it with synthetic data first.
- **Review Before Commit**: Before each commit, inspect the staged diff specifically for secrets, personal data, and financial information.
