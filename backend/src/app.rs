use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

use crate::{ingestion::ingest_csv, state::AppState};

#[derive(Debug, Serialize, PartialEq, Eq)]
struct StatusPayload {
    service: &'static str,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ImportResponse {
    batch_id: String,
    message: String,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/v1/imports", post(import_csv))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn import_csv(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<ImportResponse>), (StatusCode, String)> {
    let mut batch_id = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let name = field.name().unwrap_or_default().to_string();
        let file_name = field.file_name().unwrap_or_default().to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if name == "file" {
            let id = ingest_csv(
                &state.db,
                "generic-csv",        // Hardcoded for now
                "default-account",    // Hardcoded for now
                &file_name,
                &data,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            batch_id = Some(id);
        }
    }

    if let Some(id) = batch_id {
        Ok((
            StatusCode::ACCEPTED,
            Json(ImportResponse {
                batch_id: id.to_string(),
                message: "Import started".to_string(),
            }),
        ))
    } else {
        Err((StatusCode::BAD_REQUEST, "No file uploaded".to_string()))
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

    use crate::state::AppState;

    use super::build_router;

    fn test_state(database_url: &str) -> AppState {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy(database_url)
            .expect("database url should be valid");

        AppState { db: pool }
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
}
