# ADR 0002: Unified Financial Schema

- **Status**: Proposed
- **Date**: 2026-03-28

## Context

Different banks provide CSVs with varying columns and date formats. We need a way to aggregate these sources without creating a unique table for each bank.

## Decision

We will implement a **Three-Stage Pipeline**:
1.  **Ingest**: Raw CSV data is parsed into an intermediate structure.
2.  **Normalize**: The intermediate structure is mapped to a `mony_transaction` entity.
3.  **Persist**: The normalized data is stored in the database.

The `mony_transaction` entity will include:
- `id`: UUID
- `source_id`: Reference to a specific bank account/source.
- `external_reference`: Original ID from the bank (if any).
- `date`: ISO 8601 date.
- `amount_cents`: Signed integer (negative for expenses).
- `currency`: ISO 4217 code.
- `description`: Cleaned version of the bank label.
- `category_id`: Reference to the categorization engine.
- `metadata`: JSONB field for any extra bank-specific data.

## Consequences

- **Pros**: Easy to add new bank parsers. Single reporting API for the frontend.
- **Cons**: Requires more upfront design work to ensure the `metadata` field covers edge cases.
