use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, QueryBuilder};

#[derive(Debug, Deserialize)]
pub struct AnalyticsParams {
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedAnalyticsParams {
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Debug, thiserror::Error)]
pub enum AnalyticsError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("validation error: {0}")]
    Validation(String),
}

#[derive(Debug, Serialize, FromRow)]
pub struct SpendingByCategory {
    pub category_key: Option<String>,
    pub total_amount_minor: i64,
    pub currency: String,
    pub transaction_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct MonthlySpendingByCategory {
    pub month_start: NaiveDate,
    pub category_key: Option<String>,
    pub total_amount_minor: i64,
    pub currency: String,
    pub transaction_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AnalyticsResponse {
    pub spending_by_category: Vec<SpendingByCategory>,
}

#[derive(Debug, Serialize)]
pub struct MonthlyAnalyticsResponse {
    pub monthly_spending_by_category: Vec<MonthlySpendingByCategory>,
}

impl AnalyticsParams {
    pub fn normalized(self) -> Result<NormalizedAnalyticsParams, AnalyticsError> {
        if let (Some(date_from), Some(date_to)) = (self.date_from, self.date_to) {
            if date_from > date_to {
                return Err(AnalyticsError::Validation(
                    "date_from must be earlier than or equal to date_to".to_string(),
                ));
            }
        }

        Ok(NormalizedAnalyticsParams {
            date_from: self.date_from,
            date_to: self.date_to,
        })
    }
}

pub async fn get_spending_by_category(
    pool: &PgPool,
    params: AnalyticsParams,
) -> Result<AnalyticsResponse, AnalyticsError> {
    let params = params.normalized()?;

    let mut query = QueryBuilder::new(
        r#"
        SELECT
            category_key,
            SUM(amount_minor)::BIGINT AS total_amount_minor,
            currency,
            COUNT(*)::BIGINT AS transaction_count
        FROM ledger_transaction
        "#,
    );

    let mut has_where = false;

    if let Some(date_from) = params.date_from {
        push_filter(&mut query, &mut has_where, "transaction_date >= ");
        query.push_bind(date_from);
    }

    if let Some(date_to) = params.date_to {
        push_filter(&mut query, &mut has_where, "transaction_date <= ");
        query.push_bind(date_to);
    }

    query.push(
        r#"
        GROUP BY category_key, currency
        ORDER BY ABS(SUM(amount_minor)) DESC, category_key ASC
        "#,
    );

    let items = query
        .build_query_as::<SpendingByCategory>()
        .fetch_all(pool)
        .await?;

    Ok(AnalyticsResponse {
        spending_by_category: items,
    })
}

pub async fn get_monthly_spending_by_category(
    pool: &PgPool,
    params: AnalyticsParams,
) -> Result<MonthlyAnalyticsResponse, AnalyticsError> {
    let params = params.normalized()?;

    let mut query = QueryBuilder::new(
        r#"
        SELECT
            DATE_TRUNC('month', transaction_date)::DATE AS month_start,
            category_key,
            SUM(amount_minor)::BIGINT AS total_amount_minor,
            currency,
            COUNT(*)::BIGINT AS transaction_count
        FROM ledger_transaction
        "#,
    );

    let mut has_where = false;

    if let Some(date_from) = params.date_from {
        push_filter(&mut query, &mut has_where, "transaction_date >= ");
        query.push_bind(date_from);
    }

    if let Some(date_to) = params.date_to {
        push_filter(&mut query, &mut has_where, "transaction_date <= ");
        query.push_bind(date_to);
    }

    query.push(
        r#"
        GROUP BY DATE_TRUNC('month', transaction_date)::DATE, category_key, currency
        ORDER BY month_start ASC, ABS(SUM(amount_minor)) DESC, category_key ASC
        "#,
    );

    let items = query
        .build_query_as::<MonthlySpendingByCategory>()
        .fetch_all(pool)
        .await?;

    Ok(MonthlyAnalyticsResponse {
        monthly_spending_by_category: items,
    })
}

fn push_filter<'a>(
    query: &mut QueryBuilder<'a, sqlx::Postgres>,
    has_where_clause: &mut bool,
    left_hand_sql: &str,
) {
    if *has_where_clause {
        query.push(" AND ");
    } else {
        query.push(" WHERE ");
        *has_where_clause = true;
    }

    query.push(left_hand_sql);
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{AnalyticsError, AnalyticsParams, NormalizedAnalyticsParams};

    #[test]
    fn accepts_empty_analytics_filters() {
        let params = AnalyticsParams {
            date_from: None,
            date_to: None,
        };

        assert_eq!(
            params.normalized().unwrap(),
            NormalizedAnalyticsParams {
                date_from: None,
                date_to: None,
            }
        );
    }

    #[test]
    fn rejects_invalid_analytics_date_ranges() {
        let params = AnalyticsParams {
            date_from: Some(NaiveDate::from_ymd_opt(2026, 4, 30).unwrap()),
            date_to: Some(NaiveDate::from_ymd_opt(2026, 4, 1).unwrap()),
        };

        let error = params
            .normalized()
            .expect_err("invalid range should be rejected");

        assert_eq!(
            error.to_string(),
            AnalyticsError::Validation(
                "date_from must be earlier than or equal to date_to".to_string()
            )
            .to_string()
        );
    }
}
