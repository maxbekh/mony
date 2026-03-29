use serde::Serialize;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Serialize, FromRow)]
pub struct SpendingByCategory {
    pub category_key: Option<String>,
    pub total_amount_minor: i64,
    pub currency: String,
    pub transaction_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AnalyticsResponse {
    pub spending_by_category: Vec<SpendingByCategory>,
}

pub async fn get_spending_by_category(pool: &PgPool) -> Result<AnalyticsResponse, sqlx::Error> {
    let items = sqlx::query_as::<_, SpendingByCategory>(
        r#"
        SELECT
            category_key,
            SUM(amount_minor) as total_amount_minor,
            currency,
            COUNT(*) as transaction_count
        FROM ledger_transaction
        GROUP BY category_key, currency
        ORDER BY total_amount_minor DESC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(AnalyticsResponse {
        spending_by_category: items,
    })
}
