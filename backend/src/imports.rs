use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Serialize, FromRow)]
pub struct ImportBatchListItem {
    pub id: Uuid,
    pub source_name: String,
    pub source_account_ref: String,
    pub original_filename: String,
    pub status: String,
    pub row_count: i32,
    pub imported_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub transaction_count: i64,
}

#[derive(Debug, Serialize)]
pub struct ImportBatchListResponse {
    pub items: Vec<ImportBatchListItem>,
}

#[derive(Debug, Serialize)]
pub struct DeleteImportResponse {
    pub batch_id: Uuid,
    pub deleted_transactions: u64,
    pub deleted_rows: u64,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ImportManagementError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

pub async fn list_imports(pool: &PgPool) -> Result<ImportBatchListResponse, ImportManagementError> {
    let items = sqlx::query_as::<_, ImportBatchListItem>(
        r#"
        SELECT
            batch.id,
            batch.source_name,
            batch.source_account_ref,
            batch.original_filename,
            batch.status,
            batch.row_count,
            batch.imported_at,
            batch.created_at,
            COUNT(transaction.id)::BIGINT AS transaction_count
        FROM import_batch AS batch
        LEFT JOIN ledger_transaction AS transaction
            ON transaction.import_batch_id = batch.id
        GROUP BY
            batch.id,
            batch.source_name,
            batch.source_account_ref,
            batch.original_filename,
            batch.status,
            batch.row_count,
            batch.imported_at,
            batch.created_at
        ORDER BY batch.imported_at DESC, batch.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(ImportBatchListResponse { items })
}

pub async fn delete_import(
    pool: &PgPool,
    batch_id: Uuid,
) -> Result<Option<DeleteImportResponse>, ImportManagementError> {
    let mut tx = pool.begin().await?;

    let exists = sqlx::query_scalar::<_, Uuid>("SELECT id FROM import_batch WHERE id = $1")
        .bind(batch_id)
        .fetch_optional(&mut *tx)
        .await?;

    if exists.is_none() {
        return Ok(None);
    }

    let deleted_transactions =
        sqlx::query("DELETE FROM ledger_transaction WHERE import_batch_id = $1")
            .bind(batch_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();

    let deleted_rows = sqlx::query("DELETE FROM import_row WHERE import_batch_id = $1")
        .bind(batch_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();

    sqlx::query("DELETE FROM import_batch WHERE id = $1")
        .bind(batch_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Some(DeleteImportResponse {
        batch_id,
        deleted_transactions,
        deleted_rows,
        message: "Import deleted".to_string(),
    }))
}
