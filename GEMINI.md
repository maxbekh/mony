# AI Assistance Instructions (GEMINI.md)

This file contains foundational mandates for any AI agent collaborating on the **mony** project.

This policy applies to all AI coding assistants used in the repository, regardless of vendor or model. If another tool expects a different instruction filename, this document must be mirrored there without changing the intent.

## Development Workflow

- **Branch First**: Before making changes, create or switch to a descriptive feature branch. Do not work directly on `main`.
- **Iterative Development**: Work on one feature or sub-feature at a time. Do not try to implement the entire application in one go.
- **Small Commits**: Each change should be minimal and focused. Avoid massive diffs.
- **Commit Conventions**: Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Commit Before Handover**: Do not leave completed work uncommitted. Before handing back a finished change, create the relevant atomic commit(s).
- **Proactive Testing**: Every feature must be accompanied by relevant tests. A feature is not complete until it's verified.
- **Clean Code**: Adhere to SOLID principles and keep the codebase easy to reason about.

## Core Engineering Principles

- **YAGNI (You Ain't Gonna Need It)**: Do not implement features or abstractions based on future "what-ifs". Only code what is strictly required for the current task.
- **KISS (Keep It Simple, Stupid)**: Favor readability and simplicity over clever or "magical" code.
- **Modular Monolith**: Keep the project in a single repository but maintain clear boundaries between domains (e.g., `auth`, `accounts`, `transactions`).
- **No "Vibe Coding"**: Every architectural choice must be justified. If a complex pattern is suggested, provide a brief rationale.

## Financial Integrity & Precision

- **Integer-Only Currency**: Never use floats for money. All amounts MUST be stored as integers (in the smallest unit, e.g., cents) or using a library specifically designed for arbitrary-precision decimals (like `rust_decimal`).
- **Immutability**: Once a transaction is recorded, it should ideally be immutable. Use "adjustments" or "reversals" instead of deleting or modifying history.
- **Atomic Operations**: Use database transactions for any operation involving multiple records to ensure data consistency.

## Security Mandates (Hard Rules)

- **Zero-Trust Input**: All data coming from the frontend or external APIs must be strictly validated on the backend.
- **Least Privilege**: Services (like the database user) should only have the permissions they strictly need.
- **Dependency Audit**: Before adding a new library, evaluate its maintenance status, size, and security track record. Use `cargo-audit` for Rust.
- **Secure Defaults**: All APIs must require authentication by default unless explicitly marked as public.

## Collaborative Workflow & State Awareness

- **State Discovery**: At the start of every session or task, run `git status`, `git branch`, and `git log -n 5` to understand the current state and recent changes. Never assume the environment is exactly as you left it.
- **Feature Branching**: Work on descriptive feature branches (e.g., `feat/csv-parser`, `fix/auth-leak`). Only merge to `main` after verification.
- **Atomic Commits**: Ensure each commit represents a single logical change. If a task includes multiple unrelated concerns, split them into separate commits before handover.
- **Respect Others' Work**: Do not overwrite or refactor unrelated code without a clear reason and documentation (ADR or commit message).
- **Communication via Git**: Use descriptive commit messages and, if working on a shared branch, provide a brief summary of progress in the session history.

## Execution Checklist

For every non-trivial change, the minimum expected Git workflow is:

1. Run `git status`, `git branch`, and `git log -n 5`.
2. Create or switch to a non-`main` branch.
3. Make one logical change at a time.
4. Verify the change with the relevant checks available in the environment.
5. Create one Conventional Commit per logical change before handover.

## Technology-Specific Workflow

- **Backend (Rust/Axum)**:
  - Use `cargo clippy` and `cargo fmt` regularly.
  - Prioritize `axum` for API endpoints.
  - Implement thorough error handling using `thiserror` or similar.
- **Frontend (React/TypeScript)**:
  - Use functional components and hooks.
  - Leverage TypeScript's type system for all data structures (especially financial ones).
  - Use `npm run lint` and `npm run format`.
- **Database (PostgreSQL)**:
  - Use migrations for all schema changes (e.g., `sqlx` migrations for Rust).
  - Never store raw financial amounts as floating-point numbers; use integers (cents) or a dedicated `Decimal` type.
- **Infrastructure (Docker)**:
  - Use multi-stage builds.
  - Ensure images are minimal and based on safe images like `alpine` or `debian-slim`.

## Security & Privacy Guidelines

- **Security by Design**: Always consider the security implications of any code change (e.g., input validation, authentication, data encryption).
- **No Secrets**: Never hardcode credentials, API keys, or any sensitive data. Use environment variables and `.env` files (ensuring they are ignored by Git).
- **Local First**: Prioritize local processing and storage. Avoid external dependencies unless strictly necessary and verified for security.

## Communication

- Be concise and direct.
- Explain the "why" behind significant architectural decisions.
- Stop and ask for clarification if a requirement is ambiguous.
