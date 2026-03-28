# ADR 0003: Financial Invariants and Idempotent Imports

- **Status**: Accepted
- **Date**: 2026-03-28

## Context

The project ingests CSV exports from multiple banks. At this stage, the biggest long-term risk is not framework choice but inconsistent financial semantics and duplicate imports. If those rules are left implicit, the data model will drift and later analytics will become unreliable.

## Decision

We establish the following invariants from the start:

1. **Money Representation**
   - All monetary amounts are stored as integers in the smallest currency unit.
   - The sign convention is canonical: expenses are negative, income is positive.
   - Currency is stored explicitly on every monetary record.

2. **Append-Only Import Trail**
   - Every import creates an immutable `import_batch`.
   - The original file metadata is retained, including filename, source account, import timestamp, and a file hash.
   - The same source file must not be imported twice unintentionally.

3. **Idempotent Transaction Ingestion**
   - If a bank provides a stable external transaction identifier, it is the primary deduplication key.
   - If no stable external identifier exists, the system computes a deterministic deduplication fingerprint from stable normalized fields.
   - Deduplication must be source-aware. Two different accounts may legitimately contain the same amount, date, and description.

4. **Booked Data Over Pending Data**
   - The canonical ledger stores booked transactions.
   - Pending transactions, if supported later, must be modeled separately and must never silently overwrite booked data.

5. **No Destructive History Rewrites**
   - Imported transactions are not deleted or mutated silently.
   - Corrections are represented as explicit adjustments, reversals, or reclassification events.

6. **Manual Review for Ambiguous Matches**
   - When deduplication confidence is insufficient, the import must stop at a review state rather than guessing.

## Consequences

- **Pros**: Stable analytics, safer re-imports, clearer auditability, and fewer future migration surprises.
- **Cons**: Slightly more upfront model design and a need for explicit import metadata tables.

## Follow-Up

The first schema iteration should include at least:

- `import_batch`
- `import_row` or equivalent raw-row capture
- `transaction`
- unique constraints for source-scoped deduplication keys

The first implementation should also include fixture-based tests for duplicate file import and duplicate transaction detection.
