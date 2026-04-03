use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::categories::{auto_categorize, is_probable_legacy_salary_misclassification};

#[derive(Debug, Serialize)]
pub struct RecategorizationSummary {
    pub scanned_transactions: usize,
    pub filled_uncategorized: usize,
    pub repaired_legacy_salary: usize,
    pub cleared_legacy_salary: usize,
    pub refined_finance_transfer: usize,
    pub corrected_existing_categories: usize,
}

#[derive(Debug, sqlx::FromRow)]
struct TransactionCategoryRecord {
    id: Uuid,
    description: String,
    category_key: Option<String>,
}

pub async fn reapply_category_rules(pool: &PgPool) -> Result<RecategorizationSummary, sqlx::Error> {
    let records = sqlx::query_as::<_, TransactionCategoryRecord>(
        r#"
        SELECT id, description, category_key
        FROM ledger_transaction
        ORDER BY transaction_date DESC, created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut tx = pool.begin().await?;

    let mut filled_uncategorized = 0_usize;
    let mut repaired_legacy_salary = 0_usize;
    let mut cleared_legacy_salary = 0_usize;
    let mut refined_finance_transfer = 0_usize;
    let mut corrected_existing_categories = 0_usize;

    for record in &records {
        let suggestion = auto_categorize(&record.description);

        match (&record.category_key, suggestion.as_deref()) {
            (None, Some(category_key)) => {
                sqlx::query("UPDATE ledger_transaction SET category_key = $1 WHERE id = $2")
                    .bind(category_key)
                    .bind(record.id)
                    .execute(&mut *tx)
                    .await?;
                filled_uncategorized += 1;
            }
            (Some(current_category), suggested_category)
                if current_category == "income.salary"
                    && is_probable_legacy_salary_misclassification(&record.description) =>
            {
                match suggested_category {
                    Some(category_key) => {
                        sqlx::query(
                            "UPDATE ledger_transaction SET category_key = $1 WHERE id = $2",
                        )
                        .bind(category_key)
                        .bind(record.id)
                        .execute(&mut *tx)
                        .await?;
                        repaired_legacy_salary += 1;
                    }
                    None => {
                        sqlx::query(
                            "UPDATE ledger_transaction SET category_key = NULL WHERE id = $1",
                        )
                        .bind(record.id)
                        .execute(&mut *tx)
                        .await?;
                        cleared_legacy_salary += 1;
                    }
                }
            }
            (Some(current_category), Some(category_key))
                if current_category == "finance.transfer" && category_key != "finance.transfer" =>
            {
                sqlx::query("UPDATE ledger_transaction SET category_key = $1 WHERE id = $2")
                    .bind(category_key)
                    .bind(record.id)
                    .execute(&mut *tx)
                    .await?;
                refined_finance_transfer += 1;
            }
            (Some(current_category), Some(category_key))
                if should_correct_existing_category(current_category, category_key) =>
            {
                sqlx::query("UPDATE ledger_transaction SET category_key = $1 WHERE id = $2")
                    .bind(category_key)
                    .bind(record.id)
                    .execute(&mut *tx)
                    .await?;
                corrected_existing_categories += 1;
            }
            _ => {}
        }
    }

    tx.commit().await?;

    Ok(RecategorizationSummary {
        scanned_transactions: records.len(),
        filled_uncategorized,
        repaired_legacy_salary,
        cleared_legacy_salary,
        refined_finance_transfer,
        corrected_existing_categories,
    })
}

fn should_correct_existing_category(current_category: &str, suggested_category: &str) -> bool {
    if current_category == suggested_category {
        return false;
    }

    matches!(
        (current_category, suggested_category),
        ("transport.public", "food.grocery")
            | ("housing.rent", "finance.cash_withdrawal")
            | ("transport.fuel", "finance.cash_withdrawal")
            | ("housing.rent", "transport.parking")
            | ("transport.tolls", "transport.parking")
            | ("transport.fuel", "transport.parking")
    )
}
