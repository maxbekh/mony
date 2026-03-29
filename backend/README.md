# Backend

Rust/Axum application for the `mony` backend.

Current scope:

- service bootstrap
- configuration loading
- PostgreSQL connection and embedded migrations
- health and readiness endpoints
- tracing baseline
- generic CSV import endpoint with normalization and idempotent persistence
- transaction listing API with basic filtering and pagination

## Generic CSV Import Contract

Current endpoint: `POST /v1/imports`

Multipart form fields:

- `file`: the CSV file
- `source_name`: logical source identifier, for example `bnp-csv`
- `source_account_ref`: stable account identifier inside that source

Required CSV columns:

- `date` in `YYYY-MM-DD`
- `amount` as a decimal string
- `currency` as ISO 4217 code
- `description`

Optional CSV columns:

- `external_reference`

## Transaction Listing Contract

Current endpoint: `GET /v1/transactions`

Supported query parameters:

- `limit`
- `offset`
- `source_name`
- `source_account_ref`
- `category_key`
- `date_from`
- `date_to`
- `amount_min`
- `amount_max`
- `currency`
- `search`

Validation notes:

- `date_from` must be earlier than or equal to `date_to`
- `amount_min` must be less than or equal to `amount_max`
- `currency` must be a 3-letter ISO 4217 code

Immediate next slices:

1. Transaction detail API.
2. Category assignment and transaction enrichment.
3. Parser specializations per bank export format.
