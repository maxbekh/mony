use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum IngestionError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("csv error: {0}")]
    Csv(#[from] csv::Error),
    #[error("duplicate file import: {0}")]
    DuplicateFile(String),
    #[error("missing required field: {0}")]
    MissingField(&'static str),
    #[error("invalid date value: {0}")]
    InvalidDate(String),
    #[error("invalid amount value: {0}")]
    InvalidAmount(String),
}

#[derive(Debug, Serialize, Deserialize, sqlx::Type)]
#[sqlx(rename_all = "lowercase")]
pub enum ImportBatchStatus {
    Pending,
    Completed,
    Failed,
}

pub struct NormalizedTransaction {
    pub transaction_date: NaiveDate,
    pub amount_minor: i64,
    pub currency: String,
    pub description: String,
    pub external_reference: Option<String>,
    pub dedup_fingerprint: String,
}

pub struct RawRow {
    pub index: i32,
    pub record: serde_json::Value,
    pub hash: String,
}

pub struct IngestionSummary {
    pub batch_id: Uuid,
    pub row_count: usize,
    pub inserted_transactions: usize,
    pub skipped_duplicates: usize,
}

pub fn parse_csv(content: &[u8]) -> Result<Vec<RawRow>, IngestionError> {
    let mut rdr = csv::Reader::from_reader(content);
    let mut rows = Vec::new();

    for (index, result) in rdr.deserialize::<BTreeMap<String, String>>().enumerate() {
        let record = result?;
        let raw_record_json = serde_json::to_value(&record).expect("csv row should serialize to json");
        let raw_hash = hex::encode(Sha256::digest(raw_record_json.to_string().as_bytes()));

        rows.push(RawRow {
            index: (index + 1) as i32,
            record: raw_record_json,
            hash: raw_hash,
        });
    }

    Ok(rows)
}

fn required_string_field<'a>(
    record: &'a serde_json::Value,
    field: &'static str,
) -> Result<&'a str, IngestionError> {
    record
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(IngestionError::MissingField(field))
}

fn optional_string_field(record: &serde_json::Value, field: &'static str) -> Option<String> {
    record
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_minor_units(raw: &str) -> Result<i64, IngestionError> {
    let compact = raw
        .trim()
        .replace([' ', '\u{00A0}', '\u{202F}'], "")
        .replace('_', "");

    if compact.is_empty() {
        return Err(IngestionError::InvalidAmount(raw.to_owned()));
    }

    let sign = if compact.starts_with('-') { -1_i64 } else { 1_i64 };
    let unsigned = compact.trim_start_matches(['+', '-']);

    let decimal_separator = match (unsigned.rfind('.'), unsigned.rfind(',')) {
        (Some(dot), Some(comma)) => Some(dot.max(comma)),
        (Some(dot), None) => Some(dot),
        (None, Some(comma)) => Some(comma),
        (None, None) => None,
    };

    let (whole_part, fraction_part) = match decimal_separator {
        Some(index) => (&unsigned[..index], &unsigned[index + 1..]),
        None => (unsigned, ""),
    };

    if fraction_part.len() > 2 {
        return Err(IngestionError::InvalidAmount(raw.to_owned()));
    }

    let normalized_whole: String = whole_part
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    let normalized_fraction: String = fraction_part
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();

    if normalized_whole.is_empty() && normalized_fraction.is_empty() {
        return Err(IngestionError::InvalidAmount(raw.to_owned()));
    }

    let major = if normalized_whole.is_empty() {
        0_i64
    } else {
        normalized_whole
            .parse::<i64>()
            .map_err(|_| IngestionError::InvalidAmount(raw.to_owned()))?
    };

    let minor = match normalized_fraction.len() {
        0 => 0_i64,
        1 => normalized_fraction
            .parse::<i64>()
            .map(|value| value * 10)
            .map_err(|_| IngestionError::InvalidAmount(raw.to_owned()))?,
        2 => normalized_fraction
            .parse::<i64>()
            .map_err(|_| IngestionError::InvalidAmount(raw.to_owned()))?,
        _ => return Err(IngestionError::InvalidAmount(raw.to_owned())),
    };

    Ok(sign * ((major * 100) + minor))
}

fn compute_dedup_fingerprint(
    source_name: &str,
    source_account_ref: &str,
    date: NaiveDate,
    amount_minor: i64,
    currency: &str,
    description: &str,
) -> String {
    let canonical = format!(
        "{}|{}|{}|{}|{}|{}",
        source_name,
        source_account_ref,
        date.format("%Y-%m-%d"),
        amount_minor,
        currency,
        description.trim().to_lowercase()
    );

    hex::encode(Sha256::digest(canonical.as_bytes()))
}

fn normalize_row(
    source_name: &str,
    source_account_ref: &str,
    record: &serde_json::Value,
) -> Result<NormalizedTransaction, IngestionError> {
    let date = required_string_field(record, "date")?;
    let amount = required_string_field(record, "amount")?;
    let currency = required_string_field(record, "currency")?.to_uppercase();
    let description = required_string_field(record, "description")?.to_owned();
    let external_reference = optional_string_field(record, "external_reference");

    let transaction_date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| IngestionError::InvalidDate(date.to_owned()))?;
    let amount_minor = parse_minor_units(amount)?;
    let dedup_fingerprint = compute_dedup_fingerprint(
        source_name,
        source_account_ref,
        transaction_date,
        amount_minor,
        &currency,
        &description,
    );

    Ok(NormalizedTransaction {
        transaction_date,
        amount_minor,
        currency,
        description,
        external_reference,
        dedup_fingerprint,
    })
}

pub async fn ingest_csv(
    pool: &PgPool,
    source_name: &str,
    source_account_ref: &str,
    filename: &str,
    content: &[u8],
) -> Result<IngestionSummary, IngestionError> {
    let file_hash = hex::encode(Sha256::digest(content));
    let rows = parse_csv(content)?;
    let mut inserted_transactions = 0_usize;
    let mut skipped_duplicates = 0_usize;

    let mut tx = pool.begin().await?;

    let existing = sqlx::query(
        r#"
        SELECT id
        FROM import_batch
        WHERE source_name = $1
          AND source_account_ref = $2
          AND file_hash_sha256 = $3
        "#,
    )
    .bind(source_name)
    .bind(source_account_ref)
    .bind(file_hash.clone())
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(_row) = existing {
        return Err(IngestionError::DuplicateFile(format!(
            "duplicate file import for source '{source_name}/{source_account_ref}' ({file_hash})"
        )));
    }

    let batch_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO import_batch (
            id,
            source_name,
            source_account_ref,
            original_filename,
            file_hash_sha256,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(batch_id)
    .bind(source_name)
    .bind(source_account_ref)
    .bind(filename)
    .bind(file_hash)
    .bind("pending")
    .execute(&mut *tx)
    .await?;

    for row in &rows {
        let import_row_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO import_row (import_batch_id, row_index, raw_record, raw_hash_sha256)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            "#,
        )
        .bind(batch_id)
        .bind(row.index)
        .bind(&row.record)
        .bind(&row.hash)
        .fetch_one(&mut *tx)
        .await?;

        let normalized = normalize_row(source_name, source_account_ref, &row.record)?;
        let rows_affected = sqlx::query(
            r#"
            INSERT INTO ledger_transaction (
                id,
                import_batch_id,
                import_row_id,
                source_name,
                source_account_ref,
                external_reference,
                dedup_fingerprint,
                transaction_date,
                amount_minor,
                currency,
                description,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(batch_id)
        .bind(import_row_id)
        .bind(source_name)
        .bind(source_account_ref)
        .bind(normalized.external_reference)
        .bind(normalized.dedup_fingerprint)
        .bind(normalized.transaction_date)
        .bind(normalized.amount_minor)
        .bind(normalized.currency)
        .bind(normalized.description)
        .bind(serde_json::json!({}))
        .execute(&mut *tx)
        .await?
        .rows_affected();

        if rows_affected == 1 {
            inserted_transactions += 1;
        } else {
            skipped_duplicates += 1;
        }
    }

    sqlx::query(
        "UPDATE import_batch SET status = $1, row_count = $2 WHERE id = $3",
    )
    .bind("completed")
    .bind(rows.len() as i32)
    .bind(batch_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(IngestionSummary {
        batch_id,
        row_count: rows.len(),
        inserted_transactions,
        skipped_duplicates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_csv_extracts_rows_correctly() {
        let csv_content =
            b"date,amount,currency,description\n2026-03-01,100.00,EUR,Test 1\n2026-03-02,-50.00,EUR,Test 2";
        let rows = parse_csv(csv_content).expect("parse should succeed");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].index, 1);
        assert_eq!(rows[1].index, 2);
        assert_eq!(rows[0].record["date"], "2026-03-01");
        assert_eq!(rows[1].record["amount"], "-50.00");
    }

    #[test]
    fn parse_minor_units_handles_dot_and_comma_formats() {
        assert_eq!(parse_minor_units("100.00").unwrap(), 10_000);
        assert_eq!(parse_minor_units("-50,75").unwrap(), -5_075);
        assert_eq!(parse_minor_units("1 234,56").unwrap(), 123_456);
    }

    #[test]
    fn normalize_row_requires_generic_columns() {
        let record = serde_json::json!({
            "date": "2026-03-01",
            "amount": "100.00",
            "currency": "EUR",
            "description": "Salary",
            "external_reference": "abc-123"
        });

        let normalized = normalize_row("generic-csv", "checking", &record).unwrap();

        assert_eq!(normalized.amount_minor, 10_000);
        assert_eq!(normalized.currency, "EUR");
        assert_eq!(normalized.external_reference.as_deref(), Some("abc-123"));
    }
}
