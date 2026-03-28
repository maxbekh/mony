# AI Agent Instructions

This file is the repository-wide instruction entrypoint for any AI coding assistant working on **mony**.

This policy applies to all assistants, regardless of vendor or model.

Minimum required workflow:

1. Run `git status`, `git branch`, and `git log -n 5` before starting.
2. Work on a descriptive branch, never directly on `main`.
3. Keep changes small and logically scoped.
4. Use Conventional Commits.
5. Commit completed logical changes before handover.

## Development Workflow

- **Branch First**: Before making changes, create or switch to a descriptive feature branch. Do not work directly on `main`.
- **Iterative Development**: Work on one feature or sub-feature at a time. Do not try to implement the entire application in one go.
- **Small Commits**: Each change should be minimal and focused. Avoid massive diffs.
- **Commit Conventions**: Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Commit Before Handover**: Do not leave completed work uncommitted. Before handing back a finished change, create the relevant atomic commit(s).
- **Proactive Testing**: Every feature must be accompanied by relevant tests. A feature is not complete until it's verified.
- **Clean Code**: Keep the codebase easy to reason about. Favor explicitness over cleverness.

## Core Engineering Principles

- **YAGNI**: Do not implement features or abstractions based on future "what-ifs". Only code what is required for the current task.
- **KISS**: Favor readability and simplicity over clever or "magical" code.
- **Modular Monolith**: Keep the project in a single repository but maintain clear domain boundaries.
- **No Vibe Coding**: Every architectural choice must be justified. If a complex pattern is suggested, provide a brief rationale.

## Financial Integrity and Precision

- **Integer-Only Currency**: Never use floats for money. All amounts must be stored as integers in the smallest unit or via a decimal library chosen deliberately for financial precision.
- **Immutability**: Once a transaction is recorded, prefer adjustments or reversals instead of rewriting history.
- **Atomic Operations**: Use database transactions for any operation involving multiple records to preserve consistency.

## Security Mandates

- **Zero-Trust Input**: Validate all input from frontend, CSV imports, and external systems on the backend.
- **Least Privilege**: Services such as the database user should only have the permissions they need.
- **Dependency Audit**: Evaluate maintenance status, footprint, and security track record before adding dependencies.
- **Secure Defaults**: APIs should require authentication by default unless a route is explicitly public.

## Public Repository Data Rules

- **Assume Public Exposure**: Treat every commit, branch, pull request, log, screenshot, fixture, and code comment as public.
- **No Secrets**: Never commit API keys, access tokens, passwords, private certificates, OAuth credentials, `.env` files, or copied secrets from local machines.
- **No Real Financial Data**: Never commit real bank exports, transaction histories, account numbers, IBANs, card numbers, billing addresses, tax identifiers, or any personal financial records.
- **Synthetic or Irreversibly Anonymized Fixtures Only**: Test fixtures must be fully synthetic or anonymized so the original person, account, or institution cannot be recovered.
- **Sanitize Examples and Docs**: Sample payloads, screenshots, logs, and CSV examples must use fake names, fake identifiers, and fake values.
- **Stop If Unsure**: If there is any doubt about whether data is sensitive, do not commit it. Replace it with synthetic data first.
- **Review Before Commit**: Before each commit, inspect the staged diff specifically for secrets, personal data, and financial information.

## Execution Checklist

For every non-trivial change:

1. Run `git status`, `git branch`, and `git log -n 5`.
2. Create or switch to a non-`main` branch.
3. Make one logical change at a time.
4. Verify the change with the checks available in the environment.
5. Create one Conventional Commit per logical change before handover.
