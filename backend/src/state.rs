use crate::{auth::AuthState, providers::{AiProvider, GeminiProvider}, security::RateLimiter};
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub auth: AuthState,
    pub rate_limiter: RateLimiter,
    pub gemini_api_key: Option<String>,
}

impl AppState {
    pub fn get_ai_provider_for_user(&self, ai_settings: serde_json::Value) -> Option<Box<dyn AiProvider>> {
        // 1. Check user-specific API key
        if let Some(user_key) = ai_settings.get("gemini_api_key").and_then(|v| v.as_str()) {
            if !user_key.is_empty() {
                return Some(Box::new(GeminiProvider::new(user_key.to_string())));
            }
        }

        // 2. Check user-specific OAuth token
        if let Some(user_token) = ai_settings.get("google_oauth_token").and_then(|v| v.as_str()) {
            if !user_token.is_empty() {
                return Some(Box::new(GeminiProvider::new_with_token(user_token.to_string())));
            }
        }

        // 3. Fallback to system-wide API key
        if let Some(system_key) = &self.gemini_api_key {
            return Some(Box::new(GeminiProvider::new(system_key.clone())));
        }

        None
    }
}
