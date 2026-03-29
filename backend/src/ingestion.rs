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
}

#[derive(Debug, Serialize, Deserialize, sqlx::Type)]
#[sqlx(rename_all = "lowercase")]
pub enum ImportBatchStatus {
    Pending,
    Completed,
    Failed,
}

pub struct RawTransaction {
    pub date: NaiveDate,
    pub amount_minor: i64,
    pub currency: String,
    pub description: String,
    pub external_reference: Option<String>,
}

pub struct RawRow {
    pub index: i32,
    pub record: serde_json::Value,
    pub hash: String,
}

pub fn parse_csv(content: &[u8]) -> Result<Vec<RawRow>, IngestionError> {
    let mut rdr = csv::Reader::from_reader(content);
    let mut rows = Vec::new();

    for (index, result) in rdr.deserialize::<std::collections::BTreeMap<String, String>>().enumerate() {
        let record = result?;
        let raw_record_json = serde_json::to_value(&record).unwrap();
        let raw_hash = hex::encode(Sha256::digest(raw_record_json.to_string().as_bytes()));

        rows.push(RawRow {
            index: (index + 1) as i32,
            record: raw_record_json,
            hash: raw_hash,
        });
    }

    Ok(rows)
}

pub async fn ingest_csv(
    pool: &PgPool,
    source_name: &str,
    source_account_ref: &str,
    filename: &str,
    content: &[u8],
) -> Result<Uuid, IngestionError> {
    let file_hash = hex::encode(Sha256::digest(content));
    let rows = parse_csv(content)?;

    // Start a transaction
    let mut tx = pool.begin().await?;

    // Check for duplicate file
    let existing = sqlx::query(
        "SELECT id FROM import_batch WHERE file_hash_sha256 = $1",
    )
    .bind(file_hash.clone())
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(_row) = existing {
        return Err(IngestionError::DuplicateFile(file_hash));
    }

    let batch_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO import_batch (id, source_name, source_account_ref, original_filename, file_hash_sha256, status)
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
        sqlx::query(
            r#"
            INSERT INTO import_row (import_batch_id, row_index, raw_record, raw_hash_sha256)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(batch_id)
        .bind(row.index)
        .bind(&row.record)
        .bind(&row.hash)
        .execute(&mut *tx)
        .await?;
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

    Ok(batch_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_csv_extracts_rows_correctly() {
        let csv_content = b"date,amount,description\n2026-03-01,100.00,Test 1\n2026-03-02,-50.00,Test 2";
        let rows = parse_csv(csv_content).expect("parse should succeed");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].index, 1);
        assert_eq!(rows[1].index, 2);
        assert_eq!(rows[0].record["date"], "2026-03-01");
        assert_eq!(rows[1].record["amount"], "-50.00");
    }
}
