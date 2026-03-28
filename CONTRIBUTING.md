# Contributing

## Branch Naming

Use branch names that describe the work as a normal team would:

- `feat/<scope>` for new user-facing or domain functionality
- `fix/<scope>` for bug fixes or regressions
- `chore/<scope>` for maintenance, tooling, or repository hygiene
- `docs/<scope>` for documentation-only changes
- `refactor/<scope>` for internal code improvements without behavior change
- `test/<scope>` for tests or fixtures
- `ci/<scope>` for pipeline and automation changes

Rules:

- use lowercase kebab-case after the prefix
- keep one logical concern per branch
- avoid tool or assistant names in branch names
- examples: `feat/import-batches`, `fix/postgres-healthcheck`, `docs/security-policy`

## Commits

- Use Conventional Commits.
- Keep commits atomic and logically scoped.
- Do not mix unrelated documentation, refactors, and feature work in the same commit.

## Public Data Safety

This repository is public:

- never commit secrets or `.env` files
- never commit real financial or personal data
- use synthetic or irreversibly anonymized fixtures only
