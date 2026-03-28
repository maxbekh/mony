CREATE TABLE import_batch (
    id UUID PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_account_ref TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_hash_sha256 TEXT NOT NULL CHECK (char_length(file_hash_sha256) = 64),
    status TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_name, source_account_ref, file_hash_sha256)
);

CREATE TABLE import_row (
    id BIGSERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES import_batch(id) ON DELETE RESTRICT,
    row_index INTEGER NOT NULL CHECK (row_index >= 1),
    raw_record JSONB NOT NULL,
    raw_hash_sha256 TEXT NOT NULL CHECK (char_length(raw_hash_sha256) = 64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (import_batch_id, row_index)
);

CREATE TABLE ledger_transaction (
    id UUID PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES import_batch(id) ON DELETE RESTRICT,
    import_row_id BIGINT REFERENCES import_row(id) ON DELETE RESTRICT,
    source_name TEXT NOT NULL,
    source_account_ref TEXT NOT NULL,
    external_reference TEXT,
    dedup_fingerprint TEXT,
    transaction_date DATE NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL CHECK (currency = UPPER(currency)),
    description TEXT NOT NULL,
    category_key TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ledger_transaction_source_reference_uniq_idx
    ON ledger_transaction (source_name, source_account_ref, external_reference)
    WHERE external_reference IS NOT NULL;

CREATE UNIQUE INDEX ledger_transaction_source_fingerprint_uniq_idx
    ON ledger_transaction (source_name, source_account_ref, dedup_fingerprint)
    WHERE dedup_fingerprint IS NOT NULL;

CREATE INDEX ledger_transaction_date_idx
    ON ledger_transaction (transaction_date DESC);
