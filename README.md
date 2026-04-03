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
- **Smarter Categorization**: Improve category quality by first exploiting the current database and local deterministic rules, then adding learning from confirmed user decisions, and finally using AI only for the unresolved tail.
- **Authentication Later**: Authentication is intentionally deferred until the functional core is in place, but new backend and frontend work should avoid assumptions that would make route protection or user scoping hard to add later.

## Categorization Strategy

The categorization engine should evolve in layers instead of jumping directly to a black-box classifier:

1. **Current Data First**: Use the existing database to review weak tags, identify repeated merchants or normalized descriptions, and derive better local rules from what is already present.
2. **Deterministic Rules**: Keep a transparent rules layer based on normalized descriptions, source metadata, amount patterns, and explicit category mappings.
3. **Learning From History**: Reuse confirmed user categorizations to improve suggestions over time, especially for repeated merchants and recurring transactions.
4. **AI For The Residual Cases**: Add AI only after the local and historical layers are in place, to propose categories for ambiguous or unseen transactions.

This order is intentional: the project should first become materially better with the data it already owns before depending on external intelligence.

## Repository Boundary For Categorization

The public repository must only contain the generic categorization engine:

- generic normalization logic
- generic rule matching
- category definitions
- local-memory loading hooks

Any learned memory built from a real personal dataset must stay local and must not be committed. Examples include:

- normalized merchant-to-category mappings learned from the current database
- account- or person-specific transfer heuristics
- employer-specific salary fingerprints
- exported review artifacts derived from real transactions

Those artifacts should live under ignored local paths such as `.local/` or `data/local-learning/`.

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

## Run From Scratch

### Prerequisites

- Git
- Docker Engine with Compose support
- Rust 1.88+ via `rustup` if you want to run the backend outside Docker
- Node.js 22+ if you want to run the frontend outside Docker

### 1. Clone the repository

```bash
git clone https://github.com/maxbekh/mony.git
cd mony
```

### 2. Create local configuration

```bash
cp .env.example .env
mkdir -p .local/keys
openssl genrsa -out .local/keys/mony-jwt-private.pem 2048
openssl rsa -in .local/keys/mony-jwt-private.pem -pubout -out .local/keys/mony-jwt-public.pem
```

Then edit `.env` and at minimum replace:

- `POSTGRES_PASSWORD`
- `MONY_AUTH_SECURE_COOKIES`
  - keep `false` for local HTTP development
  - switch to `true` behind HTTPS in production

The default `.env.example` already points to host-local key paths:

- `.local/keys/mony-jwt-private.pem`
- `.local/keys/mony-jwt-public.pem`

When running in Docker Compose, the backend container overrides those paths internally and reads the same files through `/run/secrets`.

### 3. Start the full stack with Docker Compose

```bash
docker compose --env-file .env up --build -d
```

Then open:

- frontend: `http://localhost/`
- health: `http://localhost/health`
- readiness: `http://localhost/ready`
- JWKS: `http://localhost/.well-known/jwks.json`

On first launch, browse to the web app and create the initial administrator account through the bootstrap login screen. Public registration is disabled after that first account exists.

After sign-in, password changes are available from the `Settings` page in the web app.
Recent security activity is also visible from the same page, including sign-ins, failed sign-ins, password changes, and forced resets.

### 4. Stop the stack

```bash
docker compose --env-file .env down
```

To also remove PostgreSQL data:

```bash
docker compose --env-file .env down -v
```

### Optional local development without Docker for app processes

You can still use Docker only for PostgreSQL and run the backend/frontend directly on the host.

1. Start PostgreSQL:

```bash
make up-db
```

2. Run the backend:

```bash
make run-backend
```

3. Run the frontend in another shell:

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

### Optional detached local development with system services

If you want the dev database, backend, and frontend to survive SSH disconnects and be restartable from a single shell session, install the provided `systemd` units:

```bash
chmod +x scripts/install-dev-services.sh scripts/mony-services
make services-install
make services-start
```

The frontend stays on `http://<host>:5173` and still proxies API requests to the backend on `127.0.0.1:3000`.

Useful commands:

```bash
make services-status
./scripts/mony-services restart backend
./scripts/mony-services restart frontend
./scripts/mony-services logs backend
make services-stop
```

### Admin password reset

If you have shell access to the backend host and need to recover an account without the current password:

```bash
cargo run -p mony-backend -- reset-password <username>
```

The command prompts for a new password, updates the stored Argon2id hash, and revokes all existing sessions for that user.

### Validation

To validate the repository locally:

```bash
make check
```

The compose file now requires explicit environment variables to avoid accidental insecure defaults.

## Self-Hosting with Docker Compose

For a containerized deployment path, use the Docker Compose stack documented in [docs/self-hosting.md](./docs/self-hosting.md).

The frontend is exposed on `http://localhost/` and proxies API requests to the backend internally.
