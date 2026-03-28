# mony

**mony** is a self-hosted personal finance management service.

## Vision

The project aims to provide a simple, secure, and private solution for tracking finances without relying on third-party services. The design prioritizes clarity, minimality, and security by default.

## Project Status

In the early initialization phase. Features and tech stack are currently being defined.

## Initial Features (MVP)

The first phase of the project focuses on core financial tracking through file-based ingestion:

- **Multi-Source Ingestion**: Support for CSV exports from various banks.
- **Data Normalization**: A unified internal format for transactions, regardless of the source.
- **Categorization Engine**: Automatic and manual assignment of categories to transactions.
- **Spending Analytics**: Clear visualization of expenses by category, time, and source.
- **Privacy-Preserving Tracking**: All processing happens locally; no financial data ever leaves your server.

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
