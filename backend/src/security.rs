use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};

use crate::state::AppState;

const AUTH_WINDOW: Duration = Duration::from_secs(60);
const AUTH_MAX_REQUESTS: u32 = 10;

#[derive(Clone, Default)]
pub struct RateLimiter {
    buckets: Arc<Mutex<HashMap<String, RateBucket>>>,
}

#[derive(Clone)]
struct RateBucket {
    window_started_at: Instant,
    count: u32,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    fn allow(&self, key: String, now: Instant) -> bool {
        let mut buckets = self
            .buckets
            .lock()
            .expect("rate limiter mutex should not be poisoned");

        match buckets.get_mut(&key) {
            Some(bucket) if now.duration_since(bucket.window_started_at) < AUTH_WINDOW => {
                if bucket.count >= AUTH_MAX_REQUESTS {
                    false
                } else {
                    bucket.count += 1;
                    true
                }
            }
            Some(bucket) => {
                bucket.window_started_at = now;
                bucket.count = 1;
                true
            }
            None => {
                buckets.insert(
                    key,
                    RateBucket {
                        window_started_at: now,
                        count: 1,
                    },
                );
                true
            }
        }
    }
}

pub async fn rate_limit_auth(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, (StatusCode, &'static str)> {
    let path = request.uri().path().to_owned();
    let ip = request_ip_address(request.headers()).unwrap_or_else(|| "unknown".to_string());
    let key = format!("{ip}:{path}");

    if !state.rate_limiter.allow(key, Instant::now()) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "too many authentication attempts",
        ));
    }

    Ok(next.run(request).await)
}

fn request_ip_address(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            headers
                .get(header::HOST)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned)
        })
}

#[cfg(test)]
mod tests {
    use super::RateLimiter;
    use std::time::Instant;

    #[test]
    fn rate_limiter_blocks_after_limit() {
        let limiter = RateLimiter::new();
        let now = Instant::now();

        for _ in 0..10 {
            assert!(limiter.allow("127.0.0.1:/v1/auth/login".to_string(), now));
        }

        assert!(!limiter.allow("127.0.0.1:/v1/auth/login".to_string(), now));
    }
}
