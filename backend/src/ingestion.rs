use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum IngestionError {
    #[error("csv error: {0}")]
    Csv(#[from] csv::Error),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("duplicate file: {0}")]
    DuplicateFile(String),
    #[error("missing required field: {0}")]
    MissingField(&'static str),
    #[error("invalid amount: {0}")]
    InvalidAmount(String),
    #[error("invalid date: {0}")]
    InvalidDate(String),
}

#[derive(Debug, Serialize)]
pub struct RawRow {
    pub index: i32,
    pub record: serde_json::Value,
    pub hash: String,
}

#[derive(Debug)]
pub struct NormalizedTransaction {
    pub transaction_date: NaiveDate,
    pub amount_minor: i64,
    pub currency: String,
    pub description: String,
    pub external_reference: Option<String>,
    pub category_key: Option<String>,
    pub dedup_fingerprint: String,
}

#[derive(Debug, Serialize)]
pub struct IngestionSummary {
    pub batch_id: Uuid,
    pub row_count: usize,
    pub inserted_transactions: usize,
    pub skipped_duplicates: usize,
}

pub fn parse_csv(content: &[u8]) -> Result<Vec<RawRow>, IngestionError> {
    // Try to detect delimiter: check if there are more semicolons than commas in the first few lines
    let sample = String::from_utf8_lossy(&content[..content.len().min(1024)]);
    let semicolon_count = sample.matches(';').count();
    let comma_count = sample.matches(',').count();

    let delimiter = if semicolon_count > comma_count {
        b';'
    } else {
        b','
    };

    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .trim(csv::Trim::All)
        .from_reader(content);

    // Use byte_headers and byte_records to handle potential non-UTF8 encodings (like ISO-8859-1)
    let byte_headers = rdr.byte_headers()?.clone();
    let headers: Vec<String> = byte_headers
        .iter()
        .map(|h| String::from_utf8_lossy(h).trim().to_string())
        .collect();

    tracing::info!(
        ?headers,
        delimiter = (delimiter as char).to_string(),
        "parsed csv headers"
    );

    let mut rows = Vec::new();
    let mut byte_record = csv::ByteRecord::new();

    let mut index = 0;
    while rdr.read_byte_record(&mut byte_record)? {
        index += 1;
        let mut record_map = BTreeMap::new();

        let mut has_any_value = false;
        for (i, value) in byte_record.iter().enumerate() {
            if let Some(header) = headers.get(i) {
                let val_str = String::from_utf8_lossy(value).trim().to_string();
                if !val_str.is_empty() {
                    has_any_value = true;
                }
                record_map.insert(header.clone(), val_str);
            }
        }

        if !has_any_value {
            continue;
        }

        let raw_record_json =
            serde_json::to_value(&record_map).expect("csv row should serialize to json");
        let raw_hash = hex::encode(Sha256::digest(raw_record_json.to_string().as_bytes()));

        rows.push(RawRow {
            index,
            record: raw_record_json,
            hash: raw_hash,
        });
    }

    Ok(rows)
}

fn parse_minor_units(raw: &str) -> Result<i64, IngestionError> {
    let compact = raw
        .trim()
        .replace([' ', '\u{00A0}', '\u{202F}'], "")
        .replace('_', "");

    if compact.is_empty() {
        return Err(IngestionError::InvalidAmount(raw.to_owned()));
    }

    let sign = if compact.starts_with('-') {
        -1_i64
    } else {
        1_i64
    };
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

    let normalized_whole: String = whole_part.chars().filter(|c| c.is_ascii_digit()).collect();
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

fn normalize_for_match(s: &str) -> String {
    s.to_lowercase()
        .replace('\u{FFFD}', "e")
        .replace('é', "e")
        .replace('è', "e")
        .replace('ê', "e")
        .replace('à', "a")
        .replace('â', "a")
        .replace('î', "i")
        .replace('ï', "i")
        .replace('ô', "o")
        .replace('û', "u")
        .replace('ù', "u")
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn try_get_field<'a>(record: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    let obj = record.as_object()?;

    // Normalize target keys
    let normalized_targets: Vec<String> = keys.iter().map(|k| normalize_for_match(k)).collect();

    for (k, v) in obj {
        let normalized_k = normalize_for_match(k);
        for target in &normalized_targets {
            if normalized_k == *target {
                if let Some(val) = v.as_str() {
                    let trimmed = val.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed);
                    }
                }
            }
        }
    }
    None
}

fn parse_flexible_date(raw: &str) -> Result<NaiveDate, IngestionError> {
    // Try YYYY-MM-DD
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Ok(d);
    }
    // Try DD/MM/YYYY (French style)
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%d/%m/%Y") {
        return Ok(d);
    }
    // Try DD-MM-YYYY
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%d-%m-%Y") {
        return Ok(d);
    }
    Err(IngestionError::InvalidDate(raw.to_owned()))
}

fn normalize_row(
    source_name: &str,
    source_account_ref: &str,
    record: &serde_json::Value,
) -> Result<NormalizedTransaction, IngestionError> {
    // 1. Resolve Date
    let date_str = try_get_field(record, &["date", "Date"])
        .ok_or(IngestionError::MissingField("date/Date"))?;
    let transaction_date = parse_flexible_date(date_str)?;

    // 2. Resolve Amount
    // Check if we have generic 'amount' or CIC style 'Débit'/'Credit'
    let amount_minor = if let Some(a) = try_get_field(record, &["amount"]) {
        parse_minor_units(a)?
    } else {
        let debit =
            try_get_field(record, &["debit", "débit"]).and_then(|v| parse_minor_units(v).ok());
        let credit =
            try_get_field(record, &["credit", "crédit"]).and_then(|v| parse_minor_units(v).ok());

        match (debit, credit) {
            (Some(d), _) => -d.abs(), // Debit is always negative
            (_, Some(c)) => c.abs(),  // Credit is always positive
            _ => return Err(IngestionError::MissingField("amount/Débit/Crédit")),
        }
    };

    // 3. Resolve Currency (Default to EUR if missing)
    let currency = try_get_field(record, &["currency", "devise"])
        .unwrap_or("EUR")
        .to_uppercase();

    // 4. Resolve Description
    let description = try_get_field(record, &["description", "libelle", "libellé"])
        .ok_or(IngestionError::MissingField("description/Libellé"))?
        .to_owned();

    let external_reference =
        try_get_field(record, &["external_reference", "reference", "référence"])
            .map(|s| s.to_owned());

    let category_key = crate::categories::auto_categorize(&description);

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
        category_key,
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
    // Save raw file for debugging
    let debug_path = "/tmp/mony_last_import.csv";
    if let Err(e) = std::fs::write(debug_path, content) {
        tracing::error!(path = debug_path, error = %e, "failed to save debug csv");
    } else {
        tracing::info!(path = debug_path, "saved last import for debugging");
    }

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

        // Use match here because some rows might be invalid headers or footers in some CSV dialects
        match normalize_row(source_name, source_account_ref, &row.record) {
            Ok(normalized) => {
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
                        category_key,
                        metadata
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
                .bind(normalized.category_key)
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
            Err(e) => {
                tracing::warn!(index = row.index, error = %e, record = %row.record, "skipping invalid row");
            }
        }
    }

    sqlx::query("UPDATE import_batch SET status = $1, row_count = $2 WHERE id = $3")
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
    fn parse_csv_detects_semicolon() {
        let csv_content = b"Date;Libelle;Debit;Credit\n05/04/2023;Test;;94,00";
        let rows = parse_csv(csv_content).expect("parse should succeed");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].record["Libelle"], "Test");
        assert_eq!(rows[0].record["Credit"], "94,00");
    }

    #[test]
    fn normalize_row_handles_cic_format() {
        let record = serde_json::json!({
            "Date": "05/04/2023",
            "Libell\u{fffd}": "VIR CAF blabla",
            "D\u{fffd}bit": "",
            "Cr\u{fffd}dit": "94,00"
        });

        let normalized = normalize_row("cic", "acc1", &record).unwrap();
        assert_eq!(
            normalized.transaction_date,
            NaiveDate::from_ymd_opt(2023, 4, 5).unwrap()
        );
        assert_eq!(normalized.amount_minor, 9400);
        assert_eq!(normalized.description, "VIR CAF blabla");
    }

    #[test]
    fn parse_minor_units_handles_dot_and_comma_formats() {
        assert_eq!(parse_minor_units("100.00").unwrap(), 10_000);
        assert_eq!(parse_minor_units("-50,75").unwrap(), -5_075);
        assert_eq!(parse_minor_units("1 234,56").unwrap(), 123_456);
    }
}
