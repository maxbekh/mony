use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::Value;
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::{
    auth::AuthenticatedUser,
    providers::{SuggestionRequest, SuggestionResponse},
    state::AppState,
};

#[derive(Debug, Error)]
pub enum UserError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("AI provider error: {0}")]
    AiProvider(String),
    #[error("not implemented: {0}")]
    NotImplemented(String),
}

impl IntoResponse for UserError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Database(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            Self::AiProvider(err) => (StatusCode::INTERNAL_SERVER_ERROR, err),
            Self::NotImplemented(err) => (StatusCode::NOT_IMPLEMENTED, err),
        };

        (status, message).into_response()
    }
}

pub async fn get_user_ai_settings(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Result<Json<Value>, UserError> {
    let settings = get_ai_settings_from_db(&state.db, user.user_id).await?;
    Ok(Json(settings))
}

pub async fn put_user_ai_settings(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(settings): Json<Value>,
) -> Result<Json<Value>, UserError> {
    sqlx::query("UPDATE auth_user SET ai_settings = $1 WHERE id = $2")
        .bind(&settings)
        .bind(user.user_id)
        .execute(&state.db)
        .await?;

    Ok(Json(settings))
}

pub async fn post_suggest_category(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(request): Json<SuggestionRequest>,
) -> Result<Json<SuggestionResponse>, UserError> {
    let ai_settings = get_ai_settings_from_db(&state.db, user.user_id).await?;

    let provider = state
        .get_ai_provider_for_user(ai_settings)
        .ok_or_else(|| UserError::NotImplemented("AI provider not configured".to_string()))?;

    let suggestion = provider
        .suggest_category(request)
        .await
        .map_err(|e| UserError::AiProvider(e.to_string()))?;

    Ok(Json(suggestion))
}

async fn get_ai_settings_from_db(pool: &PgPool, user_id: Uuid) -> Result<Value, sqlx::Error> {
    let row: (Value,) = sqlx::query_as("SELECT ai_settings FROM auth_user WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}
