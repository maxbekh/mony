# Backend

Reserved for the Rust/Axum application.

Initial responsibility:

- CSV ingestion pipeline
- Transaction normalization
- Categorization rules
- Reporting API

The first backend slice should include:

1. A minimal Axum app with health and readiness endpoints.
2. Database connectivity and migrations.
3. A first import batch model to support idempotent CSV ingestion.
