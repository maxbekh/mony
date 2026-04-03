use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool, QueryBuilder};
use uuid::Uuid;

use crate::categories::is_valid_category_key;

#[derive(Debug, Deserialize)]
pub struct TransactionListParams {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub source_name: Option<String>,
    pub source_account_ref: Option<String>,
    pub category_key: Option<String>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    pub amount_min: Option<i64>,
    pub amount_max: Option<i64>,
    pub currency: Option<String>,
    pub search: Option<String>,
    pub uncategorized_only: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
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
    pub total_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct TransactionUpdateParams {
    pub category_key: Option<Value>,
    pub description: Option<Value>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum TransactionListError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("validation error: {0}")]
    Validation(String),
}

#[derive(Debug, thiserror::Error)]
pub enum TransactionUpdateError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("validation error: {0}")]
    Validation(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum MetadataUpdate {
    Reset,
    Merge(serde_json::Map<String, Value>),
}

impl TransactionListParams {
    pub fn normalized(self) -> Result<NormalizedTransactionListParams, TransactionListError> {
        let date_from = self.date_from;
        let date_to = self.date_to;
        let amount_min = self.amount_min;
        let amount_max = self.amount_max;
        let currency = normalize_currency(self.currency)?;

        if let (Some(date_from), Some(date_to)) = (date_from, date_to) {
            if date_from > date_to {
                return Err(TransactionListError::Validation(
                    "date_from must be earlier than or equal to date_to".to_string(),
                ));
            }
        }

        if let (Some(amount_min), Some(amount_max)) = (amount_min, amount_max) {
            if amount_min > amount_max {
                return Err(TransactionListError::Validation(
                    "amount_min must be less than or equal to amount_max".to_string(),
                ));
            }
        }

        Ok(NormalizedTransactionListParams {
            limit: self.limit.unwrap_or(50).clamp(1, 200),
            offset: self.offset.unwrap_or(0),
            source_name: normalize_optional(self.source_name),
            source_account_ref: normalize_optional(self.source_account_ref),
            category_key: normalize_optional(self.category_key),
            date_from,
            date_to,
            amount_min,
            amount_max,
            currency,
            search: normalize_optional(self.search),
            uncategorized_only: self.uncategorized_only.unwrap_or(false),
            sort_by: normalize_sort_by(self.sort_by)?,
            sort_direction: normalize_sort_direction(self.sort_direction)?,
        })
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
    pub amount_min: Option<i64>,
    pub amount_max: Option<i64>,
    pub currency: Option<String>,
    pub search: Option<String>,
    pub uncategorized_only: bool,
    pub sort_by: TransactionSortBy,
    pub sort_direction: SortDirection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionSortBy {
    Date,
    Amount,
    Category,
    Description,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    Asc,
    Desc,
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|candidate| candidate.trim().to_owned())
        .filter(|candidate| !candidate.is_empty())
}

fn normalize_currency(value: Option<String>) -> Result<Option<String>, TransactionListError> {
    let Some(currency) = normalize_optional(value) else {
        return Ok(None);
    };

    let normalized = currency.to_uppercase();
    let is_valid =
        normalized.len() == 3 && normalized.chars().all(|char| char.is_ascii_alphabetic());

    if !is_valid {
        return Err(TransactionListError::Validation(
            "currency must be a 3-letter ISO code".to_string(),
        ));
    }

    Ok(Some(normalized))
}

fn normalize_sort_by(value: Option<String>) -> Result<TransactionSortBy, TransactionListError> {
    let Some(value) = normalize_optional(value) else {
        return Ok(TransactionSortBy::Date);
    };

    match value.as_str() {
        "date" => Ok(TransactionSortBy::Date),
        "amount" => Ok(TransactionSortBy::Amount),
        "category" => Ok(TransactionSortBy::Category),
        "description" => Ok(TransactionSortBy::Description),
        _ => Err(TransactionListError::Validation(
            "sort_by must be one of: date, amount, category, description".to_string(),
        )),
    }
}

fn normalize_sort_direction(value: Option<String>) -> Result<SortDirection, TransactionListError> {
    let Some(value) = normalize_optional(value) else {
        return Ok(SortDirection::Desc);
    };

    match value.to_ascii_lowercase().as_str() {
        "asc" => Ok(SortDirection::Asc),
        "desc" => Ok(SortDirection::Desc),
        _ => Err(TransactionListError::Validation(
            "sort_direction must be one of: asc, desc".to_string(),
        )),
    }
}

pub async fn list_transactions(
    pool: &PgPool,
    params: TransactionListParams,
) -> Result<TransactionListResponse, TransactionListError> {
    let params = params.normalized()?;

    // 1. Get total count
    let mut count_query = QueryBuilder::new("SELECT COUNT(*) FROM ledger_transaction");
    let mut has_where = false;
    apply_filters_internal(&mut count_query, &params, &mut has_where);
    let total_count: i64 = count_query.build_query_scalar().fetch_one(pool).await?;

    // 2. Get items
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

    let mut has_where = false;
    apply_filters_internal(&mut query, &params, &mut has_where);

    query.push(" ORDER BY ");
    push_order_by(&mut query, &params);
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
        total_count,
    })
}

fn push_order_by(
    query: &mut QueryBuilder<'_, sqlx::Postgres>,
    params: &NormalizedTransactionListParams,
) {
    match params.sort_by {
        TransactionSortBy::Date => query.push("transaction_date"),
        TransactionSortBy::Amount => query.push("amount_minor"),
        TransactionSortBy::Category => query.push("COALESCE(category_key, '')"),
        TransactionSortBy::Description => query.push("LOWER(description)"),
    };

    match params.sort_direction {
        SortDirection::Asc => query.push(" ASC"),
        SortDirection::Desc => query.push(" DESC"),
    };

    query.push(", transaction_date DESC, created_at DESC");
}

fn apply_filters_internal<'a>(
    query: &mut QueryBuilder<'a, sqlx::Postgres>,
    params: &'a NormalizedTransactionListParams,
    has_where_clause: &mut bool,
) {
    if let Some(source_name) = &params.source_name {
        push_filter(query, has_where_clause, "source_name = ");
        query.push_bind(source_name);
    }

    if let Some(source_account_ref) = &params.source_account_ref {
        push_filter(query, has_where_clause, "source_account_ref = ");
        query.push_bind(source_account_ref);
    }

    if let Some(category_key) = &params.category_key {
        push_filter(query, has_where_clause, "category_key = ");
        query.push_bind(category_key);
    }

    if let Some(date_from) = params.date_from {
        push_filter(query, has_where_clause, "transaction_date >= ");
        query.push_bind(date_from);
    }

    if let Some(date_to) = params.date_to {
        push_filter(query, has_where_clause, "transaction_date <= ");
        query.push_bind(date_to);
    }

    if let Some(amount_min) = params.amount_min {
        push_filter(query, has_where_clause, "amount_minor >= ");
        query.push_bind(amount_min);
    }

    if let Some(amount_max) = params.amount_max {
        push_filter(query, has_where_clause, "amount_minor <= ");
        query.push_bind(amount_max);
    }

    if let Some(currency) = &params.currency {
        push_filter(query, has_where_clause, "currency = ");
        query.push_bind(currency);
    }

    if let Some(search) = &params.search {
        push_filter(query, has_where_clause, "description ILIKE ");
        query.push_bind(format!("%{search}%"));
    }

    if params.uncategorized_only {
        push_filter(query, has_where_clause, "category_key IS NULL");
    }
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
) -> Result<Option<TransactionListItem>, TransactionUpdateError> {
    let mut query = QueryBuilder::new("UPDATE ledger_transaction SET ");

    let mut has_update = false;

    if let Some(category_key) = normalize_category_update(params.category_key)? {
        query.push("category_key = ");
        query.push_bind(category_key);
        has_update = true;
    }

    if let Some(description) = normalize_description_update(params.description)? {
        if has_update {
            query.push(", ");
        }

        query.push("description = ");
        query.push_bind(description);
        has_update = true;
    }

    if let Some(metadata_update) = normalize_metadata_update(params.metadata)? {
        if has_update {
            query.push(", ");
        }

        match metadata_update {
            MetadataUpdate::Reset => {
                query.push("metadata = '{}'::jsonb");
            }
            MetadataUpdate::Merge(metadata) => {
                query.push("metadata = COALESCE(metadata, '{}'::jsonb) || ");
                query.push_bind(Value::Object(metadata));
            }
        }

        has_update = true;
    }

    if !has_update {
        return get_transaction(pool, id).await.map_err(Into::into);
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
        .map_err(Into::into)
}

fn normalize_metadata_update(
    metadata: Option<Value>,
) -> Result<Option<MetadataUpdate>, TransactionUpdateError> {
    match metadata {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(MetadataUpdate::Reset)),
        Some(Value::Object(map)) => Ok(Some(MetadataUpdate::Merge(map))),
        Some(_) => Err(TransactionUpdateError::Validation(
            "metadata must be a JSON object or null".to_string(),
        )),
    }
}

fn normalize_category_update(
    category_key: Option<Value>,
) -> Result<Option<Option<String>>, TransactionUpdateError> {
    match category_key {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(Value::String(category_key)) => {
            let normalized = normalize_optional(Some(category_key));

            match normalized {
                None => Ok(Some(None)),
                Some(category_key) => {
                    if !is_valid_category_key(&category_key) {
                        return Err(TransactionUpdateError::Validation(
                            "category_key must reference a known category".to_string(),
                        ));
                    }

                    Ok(Some(Some(category_key)))
                }
            }
        }
        Some(_) => Err(TransactionUpdateError::Validation(
            "category_key must be a string or null".to_string(),
        )),
    }
}

fn normalize_description_update(
    description: Option<Value>,
) -> Result<Option<String>, TransactionUpdateError> {
    match description {
        None => Ok(None),
        Some(Value::String(description)) => {
            let normalized = normalize_optional(Some(description)).ok_or(
                TransactionUpdateError::Validation("description must not be empty".to_string()),
            )?;

            Ok(Some(normalized))
        }
        Some(_) => Err(TransactionUpdateError::Validation(
            "description must be a string".to_string(),
        )),
    }
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
    use serde_json::{json, Value};

    use super::{
        normalize_category_update, normalize_description_update, normalize_metadata_update,
        MetadataUpdate, NormalizedTransactionListParams, SortDirection, TransactionListError,
        TransactionListParams, TransactionSortBy, TransactionUpdateError,
    };

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
            amount_min: None,
            amount_max: None,
            currency: None,
            search: Some(" groceries ".to_owned()),
            uncategorized_only: Some(true),
            sort_by: Some("amount".to_owned()),
            sort_direction: Some("asc".to_owned()),
        };

        assert_eq!(
            params.normalized().expect("params should normalize"),
            NormalizedTransactionListParams {
                limit: 50,
                offset: 0,
                source_name: Some("bank-csv".to_owned()),
                source_account_ref: Some("account-1".to_owned()),
                category_key: None,
                date_from: None,
                date_to: None,
                amount_min: None,
                amount_max: None,
                currency: None,
                search: Some("groceries".to_owned()),
                uncategorized_only: true,
                sort_by: TransactionSortBy::Amount,
                sort_direction: SortDirection::Asc,
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
            amount_min: None,
            amount_max: None,
            currency: None,
            search: None,
            uncategorized_only: None,
            sort_by: None,
            sort_direction: None,
        };

        let normalized = params.normalized().expect("params should normalize");

        assert_eq!(normalized.limit, 200);
        assert_eq!(normalized.offset, 10);
    }

    #[test]
    fn normalizes_currency_to_uppercase() {
        let params = TransactionListParams {
            limit: None,
            offset: None,
            source_name: None,
            source_account_ref: None,
            category_key: None,
            date_from: None,
            date_to: None,
            amount_min: None,
            amount_max: None,
            currency: Some(" eur ".to_string()),
            search: None,
            uncategorized_only: None,
            sort_by: None,
            sort_direction: None,
        };

        let normalized = params.normalized().expect("params should normalize");

        assert_eq!(normalized.currency.as_deref(), Some("EUR"));
    }

    #[test]
    fn rejects_invalid_date_ranges() {
        let params = TransactionListParams {
            limit: None,
            offset: None,
            source_name: None,
            source_account_ref: None,
            category_key: None,
            date_from: Some(NaiveDate::from_ymd_opt(2026, 4, 1).unwrap()),
            date_to: Some(NaiveDate::from_ymd_opt(2026, 3, 1).unwrap()),
            amount_min: None,
            amount_max: None,
            currency: None,
            search: None,
            uncategorized_only: None,
            sort_by: None,
            sort_direction: None,
        };

        let error = params
            .normalized()
            .expect_err("date range should be rejected");

        assert_eq!(
            error.to_string(),
            TransactionListError::Validation(
                "date_from must be earlier than or equal to date_to".to_string()
            )
            .to_string()
        );
    }

    #[test]
    fn rejects_invalid_amount_ranges() {
        let params = TransactionListParams {
            limit: None,
            offset: None,
            source_name: None,
            source_account_ref: None,
            category_key: None,
            date_from: None,
            date_to: None,
            amount_min: Some(500),
            amount_max: Some(100),
            currency: None,
            search: None,
            uncategorized_only: None,
            sort_by: None,
            sort_direction: None,
        };

        let error = params
            .normalized()
            .expect_err("amount range should be rejected");

        assert_eq!(
            error.to_string(),
            TransactionListError::Validation(
                "amount_min must be less than or equal to amount_max".to_string()
            )
            .to_string()
        );
    }

    #[test]
    fn rejects_invalid_currency_filters() {
        let params = TransactionListParams {
            limit: None,
            offset: None,
            source_name: None,
            source_account_ref: None,
            category_key: None,
            date_from: None,
            date_to: None,
            amount_min: None,
            amount_max: None,
            currency: Some("EURO".to_string()),
            search: None,
            uncategorized_only: None,
            sort_by: None,
            sort_direction: None,
        };

        let error = params
            .normalized()
            .expect_err("currency should be rejected");

        assert_eq!(
            error.to_string(),
            TransactionListError::Validation("currency must be a 3-letter ISO code".to_string())
                .to_string()
        );
    }

    #[test]
    fn rejects_invalid_sort_fields() {
        let params = TransactionListParams {
            limit: None,
            offset: None,
            source_name: None,
            source_account_ref: None,
            category_key: None,
            date_from: None,
            date_to: None,
            amount_min: None,
            amount_max: None,
            currency: None,
            search: None,
            uncategorized_only: None,
            sort_by: Some("created_at".to_string()),
            sort_direction: None,
        };

        let error = params
            .normalized()
            .expect_err("sort field should be rejected");

        assert_eq!(
            error.to_string(),
            TransactionListError::Validation(
                "sort_by must be one of: date, amount, category, description".to_string()
            )
            .to_string()
        );
    }

    #[test]
    fn rejects_invalid_sort_directions() {
        let params = TransactionListParams {
            limit: None,
            offset: None,
            source_name: None,
            source_account_ref: None,
            category_key: None,
            date_from: None,
            date_to: None,
            amount_min: None,
            amount_max: None,
            currency: None,
            search: None,
            uncategorized_only: None,
            sort_by: None,
            sort_direction: Some("sideways".to_string()),
        };

        let error = params
            .normalized()
            .expect_err("sort direction should be rejected");

        assert_eq!(
            error.to_string(),
            TransactionListError::Validation(
                "sort_direction must be one of: asc, desc".to_string()
            )
            .to_string()
        );
    }

    #[test]
    fn accepts_object_metadata_for_merge_updates() {
        let metadata = json!({
            "note": "Reviewed",
            "labels": ["needs-followup"]
        });

        let normalized =
            normalize_metadata_update(Some(metadata)).expect("metadata should be valid");

        assert_eq!(
            normalized,
            Some(MetadataUpdate::Merge(
                json!({
                    "note": "Reviewed",
                    "labels": ["needs-followup"]
                })
                .as_object()
                .expect("object literal")
                .clone()
            ))
        );
    }

    #[test]
    fn treats_null_metadata_as_reset() {
        let normalized =
            normalize_metadata_update(Some(serde_json::Value::Null)).expect("null is valid");

        assert_eq!(normalized, Some(MetadataUpdate::Reset));
    }

    #[test]
    fn rejects_scalar_metadata_updates() {
        let error = normalize_metadata_update(Some(json!("invalid")))
            .expect_err("scalar metadata should be rejected");

        assert_eq!(
            error.to_string(),
            "validation error: metadata must be a JSON object or null"
        );
    }

    #[test]
    fn accepts_known_category_keys_and_null_reset() {
        assert_eq!(
            normalize_category_update(Some(json!("food.grocery"))).unwrap(),
            Some(Some("food.grocery".to_string()))
        );
        assert_eq!(
            normalize_category_update(Some(Value::Null)).unwrap(),
            Some(None)
        );
    }

    #[test]
    fn rejects_unknown_category_keys() {
        let error = normalize_category_update(Some(json!("unknown.category")))
            .expect_err("unknown category should be rejected");

        assert_eq!(
            error.to_string(),
            TransactionUpdateError::Validation(
                "category_key must reference a known category".to_string()
            )
            .to_string()
        );
    }

    #[test]
    fn normalizes_trimmed_description_updates() {
        assert_eq!(
            normalize_description_update(Some(json!("  Grocery run  "))).unwrap(),
            Some("Grocery run".to_string())
        );
    }

    #[test]
    fn rejects_empty_description_updates() {
        let error = normalize_description_update(Some(json!("   ")))
            .expect_err("empty description should be rejected");

        assert_eq!(
            error.to_string(),
            TransactionUpdateError::Validation("description must not be empty".to_string())
                .to_string()
        );
    }
}
