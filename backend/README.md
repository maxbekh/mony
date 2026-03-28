# Backend

Rust/Axum application for the `mony` backend.

Current scope:

- service bootstrap
- configuration loading
- PostgreSQL connection and embedded migrations
- health and readiness endpoints
- tracing baseline

Immediate next slices:

1. Database connectivity and migrations.
2. `import_batch`, `import_row`, and `transaction` schema.
3. CSV import orchestration with idempotency rules.
