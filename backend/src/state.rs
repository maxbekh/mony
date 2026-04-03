use crate::{auth::AuthState, security::RateLimiter};
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub auth: AuthState,
    pub rate_limiter: RateLimiter,
}
