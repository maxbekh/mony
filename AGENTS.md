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

### Phase 5: Dashboard Intelligence & Personalization
- **Task 5.1**: Define a dashboard widget system with a small set of default cards and charts plus user-controlled layout and visibility.
- **Task 5.2**: Add time-series analytics endpoints grouped by month and category so the UI can answer questions like "groceries by month".
- **Task 5.3**: Add comparative analytics (current period vs previous period) with absolute and percentage deltas by category, merchant, and income/spending totals.
- **Task 5.4**: Surface recurring-payment and subscription-like transaction patterns with explicit confidence and easy user correction.
- **Task 5.5**: Surface anomaly-oriented insights such as unusually high spending, category spikes, and uncategorized or low-confidence transactions.
- **Task 5.6**: Persist per-user dashboard preferences (selected widgets, ordering, pinned categories, default period) without hard-coding one universal layout.

## Product Direction: Intelligent Financial Dashboard

The product should help users understand their money quickly, then let them go deeper without forcing everyone into the same dashboard. The default experience should feel useful immediately, but the long-term model should be a **user-configurable dashboard** built from small analytics widgets backed by stable server-side aggregates.

### Dashboard Product Principles

- **Useful by default**: Ship a strong out-of-the-box dashboard before exposing too many knobs.
- **Configurable, not chaotic**: Let users show, hide, reorder, and pin widgets or categories, but keep the data model and interactions simple.
- **Overview first, investigation second**: The dashboard should answer "what changed?" while the analytics screens answer "why?" and "where exactly?".
- **Explainable insights**: Every smart insight must be traceable to visible transactions, categories, or comparison windows.
- **Financially honest**: Avoid vanity metrics or misleading percentages on small bases. Always preserve exact integer-backed amounts.
- **Local-first intelligence**: Prefer insights derived from the user's own categorized history before considering optional AI assistance.

### Default Dashboard Widgets

Agents building dashboard or analytics features should prioritize a compact default set such as:

- **Spending by category (current period)**: Fast visual split of where money went.
- **Monthly trend for a selected category**: Example: groceries spending by month over the last 6 or 12 months.
- **Income vs expenses vs net savings**: Core cash-flow summary over the selected window.
- **Period-over-period deltas**: Show what increased or decreased versus the previous month or previous equivalent period.
- **Top merchants / payees**: Useful concentration view for identifying major recurring sinks.
- **Recurring payments and subscriptions**: Detect repeated charges and show next expected cadence when confidence is sufficient.
- **Large or unusual transactions**: Highlight outliers compared with the user's normal history.
- **Category drift / uncategorized queue**: Surface transactions needing review, weak categorization, or newly emerging merchants.

### Suggested Analytics Views Beyond The Dashboard

- **Category over time**: One or more categories plotted monthly to answer questions like "how are groceries evolving over time?".
- **Monthly spending heatmap**: Show spend intensity by month and category.
- **Cash-flow timeline**: Show income and expense movement across weeks or months.
- **Merchant deep dive**: Trend, count, average ticket, and latest transactions for a merchant.
- **Category comparison table**: Current month, previous month, delta, rolling average, and share of total spend.
- **Recurring commitments view**: Expected fixed or semi-fixed charges, grouped by cadence.

### Implementation Guidance For Agents

- Keep the backend contract widget-friendly: reusable aggregate endpoints are better than UI-specific one-off payloads.
- Prefer server-side grouping for month/category/merchant analytics to avoid heavy client-side recomputation.
- Define comparison windows explicitly (`current`, `previous_equivalent`, `rolling_n_months`) so the UI does not invent inconsistent logic.
- Any "smart" labeling such as recurring payment or anomaly detection must expose a reason or confidence level.
- User personalization should be limited to layout and preferences first; avoid building a full custom report builder too early.
- If a widget cannot be backed by reliable data yet, omit it rather than guessing.

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
