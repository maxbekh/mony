use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, QueryBuilder};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct TransactionListParams {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub source_name: Option<String>,
    pub source_account_ref: Option<String>,
    pub category_key: Option<String>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct TransactionListItem {
    pub id: Uuid,
    pub import_batch_id: Uuid,
    pub source_name: String,
    pub source_account_ref: String,
    pub external_reference: Option<String>,
    pub transaction_date: NaiveDate,
    pub amount_minor: i64,
    pub currency: String,
    pub description: String,
    pub category_key: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct TransactionListResponse {
    pub items: Vec<TransactionListItem>,
    pub limit: u32,
    pub offset: u32,
    pub returned: usize,
}

#[derive(Debug, Deserialize)]
pub struct TransactionUpdateParams {
    pub category_key: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

impl TransactionListParams {
    pub fn normalized(self) -> NormalizedTransactionListParams {
        NormalizedTransactionListParams {
            limit: self.limit.unwrap_or(50).clamp(1, 200),
            offset: self.offset.unwrap_or(0),
            source_name: normalize_optional(self.source_name),
            source_account_ref: normalize_optional(self.source_account_ref),
            category_key: normalize_optional(self.category_key),
            date_from: self.date_from,
            date_to: self.date_to,
            search: normalize_optional(self.search),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedTransactionListParams {
    pub limit: u32,
    pub offset: u32,
    pub source_name: Option<String>,
    pub source_account_ref: Option<String>,
    pub category_key: Option<String>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    pub search: Option<String>,
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|candidate| candidate.trim().to_owned())
        .filter(|candidate| !candidate.is_empty())
}

pub async fn list_transactions(
    pool: &PgPool,
    params: TransactionListParams,
) -> Result<TransactionListResponse, sqlx::Error> {
    let params = params.normalized();

    let mut query = QueryBuilder::new(
        r#"
        SELECT
            id,
            import_batch_id,
            source_name,
            source_account_ref,
            external_reference,
            transaction_date,
            amount_minor,
            currency,
            description,
            category_key,
            metadata,
            created_at
        FROM ledger_transaction
        "#,
    );

    let mut has_where_clause = false;

    if let Some(source_name) = &params.source_name {
        push_filter(&mut query, &mut has_where_clause, "source_name = ");
        query.push_bind(source_name);
    }

    if let Some(source_account_ref) = &params.source_account_ref {
        push_filter(&mut query, &mut has_where_clause, "source_account_ref = ");
        query.push_bind(source_account_ref);
    }

    if let Some(category_key) = &params.category_key {
        push_filter(&mut query, &mut has_where_clause, "category_key = ");
        query.push_bind(category_key);
    }

    if let Some(date_from) = params.date_from {
        push_filter(&mut query, &mut has_where_clause, "transaction_date >= ");
        query.push_bind(date_from);
    }

    if let Some(date_to) = params.date_to {
        push_filter(&mut query, &mut has_where_clause, "transaction_date <= ");
        query.push_bind(date_to);
    }

    if let Some(search) = &params.search {
        push_filter(
            &mut query,
            &mut has_where_clause,
            "description ILIKE ",
        );
        query.push_bind(format!("%{search}%"));
    }

    query.push(" ORDER BY transaction_date DESC, created_at DESC");
    query.push(" LIMIT ");
    query.push_bind(i64::from(params.limit));
    query.push(" OFFSET ");
    query.push_bind(i64::from(params.offset));

    let items = query
        .build_query_as::<TransactionListItem>()
        .fetch_all(pool)
        .await?;

    Ok(TransactionListResponse {
        returned: items.len(),
        items,
        limit: params.limit,
        offset: params.offset,
    })
}

pub async fn get_transaction(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<TransactionListItem>, sqlx::Error> {
    sqlx::query_as::<_, TransactionListItem>(
        r#"
        SELECT
            id,
            import_batch_id,
            source_name,
            source_account_ref,
            external_reference,
            transaction_date,
            amount_minor,
            currency,
            description,
            category_key,
            metadata,
            created_at
        FROM ledger_transaction
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_transaction(
    pool: &PgPool,
    id: Uuid,
    params: TransactionUpdateParams,
) -> Result<Option<TransactionListItem>, sqlx::Error> {
    let mut query = QueryBuilder::new("UPDATE ledger_transaction SET ");

    let mut has_update = false;

    if let Some(category_key) = params.category_key {
        let normalized = normalize_optional(Some(category_key));
        query.push("category_key = ");
        query.push_bind(normalized);
        has_update = true;
    }

    if let Some(metadata) = params.metadata {
        if has_update {
            query.push(", ");
        }
        query.push("metadata = ");
        query.push_bind(metadata);
        has_update = true;
    }

    if !has_update {
        return get_transaction(pool, id).await;
    }

    query.push(" WHERE id = ");
    query.push_bind(id);
    query.push(
        r#"
        RETURNING
            id,
            import_batch_id,
            source_name,
            source_account_ref,
            external_reference,
            transaction_date,
            amount_minor,
            currency,
            description,
            category_key,
            metadata,
            created_at
        "#,
    );

    query
        .build_query_as::<TransactionListItem>()
        .fetch_optional(pool)
        .await
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

    use super::{NormalizedTransactionListParams, TransactionListParams};

    #[test]
    fn normalizes_default_pagination_and_trims_filters() {
        let params = TransactionListParams {
            limit: None,
            offset: None,
            source_name: Some("  bank-csv  ".to_owned()),
            source_account_ref: Some("  account-1 ".to_owned()),
            category_key: Some(" ".to_owned()),
            date_from: None,
            date_to: None,
            search: Some(" groceries ".to_owned()),
        };

        assert_eq!(
            params.normalized(),
            NormalizedTransactionListParams {
                limit: 50,
                offset: 0,
                source_name: Some("bank-csv".to_owned()),
                source_account_ref: Some("account-1".to_owned()),
                category_key: None,
                date_from: None,
                date_to: None,
                search: Some("groceries".to_owned()),
            }
        );
    }

    #[test]
    fn clamps_limit_to_reasonable_bounds() {
        let params = TransactionListParams {
            limit: Some(1_000),
            offset: Some(10),
            source_name: None,
            source_account_ref: None,
            category_key: None,
            date_from: Some(NaiveDate::from_ymd_opt(2026, 3, 1).unwrap()),
            date_to: Some(NaiveDate::from_ymd_opt(2026, 3, 31).unwrap()),
            search: None,
        };

        let normalized = params.normalized();

        assert_eq!(normalized.limit, 200);
        assert_eq!(normalized.offset, 10);
    }
}
