use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::Serialize;
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

use crate::{
    analytics::{get_spending_by_category, AnalyticsError, AnalyticsParams, AnalyticsResponse},
    auth::{
        bootstrap, bootstrap_status, change_password, jwks, list_sessions, login, logout,
        logout_all, refresh, require_auth, revoke_session_handler, session,
    },
    categories::{list_categories, Category},
    imports::{
        delete_import, list_imports, DeleteImportResponse, ImportBatchListResponse,
        ImportManagementError,
    },
    ingestion::ingest_csv,
    state::AppState,
    transactions::{
        get_transaction, list_transactions, update_transaction, TransactionListError,
        TransactionListItem, TransactionListParams, TransactionListResponse,
        TransactionUpdateError, TransactionUpdateParams,
    },
};

#[derive(Debug, Serialize, PartialEq, Eq)]
struct StatusPayload {
    service: &'static str,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ImportResponse {
    batch_id: String,
    row_count: usize,
    inserted_transactions: usize,
    skipped_duplicates: usize,
    message: String,
}

pub fn build_router(state: AppState) -> Router {
    let protected_api = Router::new()
        .route("/v1/imports", post(import_csv).get(get_imports))
        .route("/v1/imports/{id}", delete(delete_import_batch))
        .route("/v1/transactions", get(get_transactions))
        .route("/v1/transactions/{id}", get(get_transaction_by_id))
        .route("/v1/transactions/{id}", patch(patch_transaction))
        .route(
            "/v1/analytics/spending-by-category",
            get(get_analytics_spending),
        )
        .route("/v1/categories", get(get_categories))
        .route("/v1/auth/session", get(session))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/logout/all", post(logout_all))
        .route("/v1/auth/change-password", post(change_password))
        .route("/v1/auth/sessions", get(list_sessions))
        .route("/v1/auth/sessions/{id}", delete(revoke_session_handler))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/.well-known/jwks.json", get(jwks))
        .route("/v1/auth/bootstrap/status", get(bootstrap_status))
        .route("/v1/auth/bootstrap", post(bootstrap))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/refresh", post(refresh))
        .merge(protected_api)
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn get_analytics_spending(
    State(state): State<AppState>,
    Query(params): Query<AnalyticsParams>,
) -> Result<Json<AnalyticsResponse>, (StatusCode, String)> {
    let response = get_spending_by_category(&state.db, params)
        .await
        .map_err(map_analytics_error)?;

    Ok(Json(response))
}

async fn get_categories() -> Json<Vec<Category>> {
    Json(list_categories())
}

async fn import_csv(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<ImportResponse>), (StatusCode, String)> {
    let mut file_name = None;
    let mut file_data = None;
    let mut source_name = None;
    let mut source_account_ref = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let name = field.name().unwrap_or_default().to_string();

        match name.as_str() {
            "file" => {
                let uploaded_name = field.file_name().unwrap_or("upload.csv").to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

                file_name = Some(uploaded_name);
                file_data = Some(data);
            }
            "source_name" => {
                source_name = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
                );
            }
            "source_account_ref" => {
                source_account_ref = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
                );
            }
            _ => {
                let _ = field
                    .bytes()
                    .await
                    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            }
        }
    }

    let file_name = file_name.ok_or((StatusCode::BAD_REQUEST, "Missing file part".to_string()))?;
    let file_data =
        file_data.ok_or((StatusCode::BAD_REQUEST, "Missing file payload".to_string()))?;
    let source_name = source_name
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or((StatusCode::BAD_REQUEST, "Missing source_name".to_string()))?;
    let source_account_ref = source_account_ref
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "Missing source_account_ref".to_string(),
        ))?;

    let summary = ingest_csv(
        &state.db,
        &source_name,
        &source_account_ref,
        &file_name,
        &file_data,
    )
    .await
    .map_err(map_ingestion_error)?;

    Ok((
        StatusCode::CREATED,
        Json(ImportResponse {
            batch_id: summary.batch_id.to_string(),
            row_count: summary.row_count,
            inserted_transactions: summary.inserted_transactions,
            skipped_duplicates: summary.skipped_duplicates,
            message: "Import completed".to_string(),
        }),
    ))
}

async fn get_imports(
    State(state): State<AppState>,
) -> Result<Json<ImportBatchListResponse>, (StatusCode, String)> {
    let response = list_imports(&state.db)
        .await
        .map_err(map_import_management_error)?;

    Ok(Json(response))
}

async fn delete_import_batch(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<DeleteImportResponse>, (StatusCode, String)> {
    let response = delete_import(&state.db, id)
        .await
        .map_err(map_import_management_error)?
        .ok_or((StatusCode::NOT_FOUND, "Import not found".to_string()))?;

    Ok(Json(response))
}

fn map_ingestion_error(error: crate::ingestion::IngestionError) -> (StatusCode, String) {
    match error {
        crate::ingestion::IngestionError::DuplicateFile(message) => (StatusCode::CONFLICT, message),
        crate::ingestion::IngestionError::MissingField(_)
        | crate::ingestion::IngestionError::InvalidDate(_)
        | crate::ingestion::IngestionError::InvalidAmount(_)
        | crate::ingestion::IngestionError::Csv(_) => (StatusCode::BAD_REQUEST, error.to_string()),
        crate::ingestion::IngestionError::Database(_) => {
            (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
        }
    }
}

fn map_import_management_error(error: ImportManagementError) -> (StatusCode, String) {
    match error {
        ImportManagementError::Database(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
        }
    }
}

fn map_analytics_error(error: AnalyticsError) -> (StatusCode, String) {
    match error {
        AnalyticsError::Validation(message) => (StatusCode::BAD_REQUEST, message),
        AnalyticsError::Database(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn get_transactions(
    State(state): State<AppState>,
    Query(params): Query<TransactionListParams>,
) -> Result<Json<TransactionListResponse>, (StatusCode, String)> {
    let response = list_transactions(&state.db, params)
        .await
        .map_err(map_transaction_list_error)?;

    Ok(Json(response))
}

fn map_transaction_list_error(error: TransactionListError) -> (StatusCode, String) {
    match error {
        TransactionListError::Validation(message) => (StatusCode::BAD_REQUEST, message),
        TransactionListError::Database(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
        }
    }
}

async fn get_transaction_by_id(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<TransactionListItem>, (StatusCode, String)> {
    let transaction = get_transaction(&state.db, id)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Transaction not found".to_string()))?;

    Ok(Json(transaction))
}

async fn patch_transaction(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
    Json(params): Json<TransactionUpdateParams>,
) -> Result<Json<TransactionListItem>, (StatusCode, String)> {
    let transaction = update_transaction(&state.db, id, params)
        .await
        .map_err(map_transaction_update_error)?
        .ok_or((StatusCode::NOT_FOUND, "Transaction not found".to_string()))?;

    Ok(Json(transaction))
}

fn map_transaction_update_error(error: TransactionUpdateError) -> (StatusCode, String) {
    match error {
        TransactionUpdateError::Validation(message) => (StatusCode::BAD_REQUEST, message),
        TransactionUpdateError::Database(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
        }
    }
}

async fn health() -> (StatusCode, Json<StatusPayload>) {
    (
        StatusCode::OK,
        Json(StatusPayload {
            service: "mony-backend",
            status: "ok",
        }),
    )
}

async fn ready(
    State(state): State<AppState>,
) -> Result<(StatusCode, Json<StatusPayload>), StatusCode> {
    readiness_check(&state.db)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    Ok((
        StatusCode::OK,
        Json(StatusPayload {
            service: "mony-backend",
            status: "ready",
        }),
    ))
}

async fn readiness_check(pool: &PgPool) -> Result<(), sqlx::Error> {
    let _ = sqlx::query_scalar::<_, i32>("select 1")
        .fetch_one(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use serde_json::json;
    use sqlx::postgres::PgPoolOptions;
    use tower::util::ServiceExt;

    use crate::{auth::test_support, state::AppState};

    use super::build_router;

    fn test_state(database_url: &str) -> AppState {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy(database_url)
            .expect("database url should be valid");

        AppState {
            db: pool,
            auth: test_support::auth_state(),
        }
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok_payload() {
        let response = build_router(test_state("postgres://mony:mony@127.0.0.1:5432/mony"))
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should be readable");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("body should be valid json");

        assert_eq!(
            payload,
            json!({
                "service": "mony-backend",
                "status": "ok"
            })
        );
    }

    #[tokio::test]
    async fn readiness_endpoint_returns_service_unavailable_when_database_is_unreachable() {
        let response = build_router(test_state("postgres://mony:mony@127.0.0.1:1/mony"))
            .oneshot(
                Request::builder()
                    .uri("/ready")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should be readable");

        assert!(body.is_empty());
    }

    #[tokio::test]
    async fn protected_routes_require_authentication() {
        let response = build_router(test_state("postgres://mony:mony@127.0.0.1:5432/mony"))
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/transactions/{}", uuid::Uuid::new_v4()))
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
