# ADR 0001: Initial Tech Stack Selection

- **Status**: Accepted
- **Date**: 2026-03-28

## Context

The **mony** project is a self-hosted personal finance tool. Key priorities are data integrity, memory safety, and minimal resource footprint for self-hosting.

## Decision

We chose the following technologies:
1. **Rust (Axum)** for the backend: Memory safety and efficiency.
2. **React (Vite/TS)** for the frontend: High interactivity and strong type safety.
3. **PostgreSQL** for the database: ACID compliance for financial data.
4. **Docker** for deployment: Portability and isolation.

## Consequences

- **Pros**: Strong safety guarantees, low resource usage, modern and robust ecosystem.
- **Cons**: Slightly higher initial learning curve and development time for Rust compared to higher-level languages.
