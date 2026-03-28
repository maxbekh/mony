use axum::{http::StatusCode, routing::get, Json, Router};
use serde::Serialize;
use tower_http::trace::TraceLayer;

#[derive(Debug, Serialize, PartialEq, Eq)]
struct StatusPayload {
    service: &'static str,
    status: &'static str,
}

pub fn build_router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .layer(TraceLayer::new_for_http())
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

async fn ready() -> (StatusCode, Json<StatusPayload>) {
    (
        StatusCode::OK,
        Json(StatusPayload {
            service: "mony-backend",
            status: "ready",
        }),
    )
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use serde_json::json;
    use tower::util::ServiceExt;

    use super::build_router;

    #[tokio::test]
    async fn health_endpoint_returns_ok_payload() {
        let response = build_router()
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
    async fn readiness_endpoint_returns_ready_payload() {
        let response = build_router()
            .oneshot(
                Request::builder()
                    .uri("/ready")
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
                "status": "ready"
            })
        );
    }
}
