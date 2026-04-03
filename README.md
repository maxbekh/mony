# mony

**mony** is a self-hosted personal finance management service.

## Vision

The project aims to provide a simple, secure, and private solution for tracking finances without relying on third-party services. The design prioritizes clarity, minimality, and security by default.

## Project Status

The project is in an active MVP build phase.

The repository now contains:

- project-level guidance and architecture notes
- local PostgreSQL bootstrap
- a Rust/Axum backend with health, readiness, CSV import, transaction update flows, category listing, and analytics endpoints
- a React/Vite/TypeScript frontend with routing, layout, and typed API integration
- Docker and Make targets for validation and local runs

The current codebase already supports the core import-to-review loop. The next slices should deepen data management and dashboard usefulness rather than adding more scaffolding.

## Initial Features (MVP)

The first phase of the project focuses on core financial tracking through file-based ingestion:

- **Multi-Source Ingestion**: Support for CSV exports from various banks.
- **Data Normalization**: A unified internal format for transactions, regardless of the source.
- **Categorization Engine**: Automatic and manual assignment of categories to transactions.
- **Spending Analytics**: Clear visualization of expenses by category, time, and source.
- **Privacy-Preserving Tracking**: All processing happens locally; no financial data ever leaves your server.
- **Transaction Review**: Filter and inspect imported transactions before richer workflows are added.

## Current Focus

The next product slices are centered on data stewardship and day-to-day usability:

- **Import Management**: Manage imported data per source and account reference, including deletion and review flows.
- **Transaction Refinement**: Improve transaction editing, especially category and description management.
- **Dashboard Time Windows**: Add selectable periods to make summaries useful over different ranges.
- **Analytics Alignment**: Clarify the boundary between dashboard summaries and analytics views so they do not overlap awkwardly.
- **Authentication Later**: Authentication is intentionally deferred until the functional core is in place, but new backend and frontend work should avoid assumptions that would make route protection or user scoping hard to add later.

## Tech Stack

- **Backend**: [Rust](https://www.rust-lang.org/) (Framework: [Axum](https://github.com/tokio-rs/axum)) - Chosen for security, memory safety, and high performance.
- **Frontend**: [React](https://reactjs.org/) (with [Vite](https://vitejs.dev/) & [TypeScript](https://www.typescriptlang.org/)) - Chosen for its reactive nature and massive community support.
- **Database**: [PostgreSQL](https://www.postgresql.org/) - Chosen for its reliability and ACID compliance, essential for financial data.
- **Infrastructure**: [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/) - For easy self-hosting and deployment.

## Guiding Principles

- **Self-hosted**: Total control over your financial data.
- **Security by Design**: Security is not an afterthought; it's integrated from the start.
- **Iterative & Clean**: Clean, tested code developed in small, manageable increments.
- **Privacy First**: No telemetry, no external tracking.

## Public Repository Safety

This repository is public. Do not commit:

- real bank exports or transaction histories
- account numbers, IBANs, card numbers, or billing details
- secrets such as `.env` files, tokens, passwords, certificates, or API keys
- screenshots, logs, or fixtures containing real personal data

Any example dataset or fixture added to the repository must be synthetic or irreversibly anonymized.

## Collaboration Workflow

- Branch naming and contribution rules are documented in [CONTRIBUTING.md](./CONTRIBUTING.md).
- AI-specific execution rules are documented in [AGENTS.md](./AGENTS.md).

## Repository Layout

- `backend/`: Rust/Axum application.
- `frontend/`: React/Vite application boundary.
- `docs/adr/`: Architecture Decision Records.
- `docker-compose.yml`: Local PostgreSQL bootstrap.
- `Cargo.toml`: Workspace root for Rust tooling.

## Local Bootstrap

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD` with a long random password.
3. Install Rust 1.88 or newer with `rustup` if it is not already available.
4. Validate the project with `make check`.
5. Start PostgreSQL with `make up-db`.
6. Run the backend with `make run-backend`.

The compose file now requires explicit environment variables to avoid accidental insecure defaults.

## Self-Hosting with Docker Compose

For a containerized deployment path, use the Docker Compose stack documented in [docs/self-hosting.md](./docs/self-hosting.md).

Quick start:

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD`.
3. Run `docker compose --env-file .env up --build -d`.

The frontend is exposed on `http://localhost/` and proxies API requests to the backend internally.
