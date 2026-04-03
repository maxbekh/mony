use std::{fs, sync::Arc};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{FromRequestParts, Path, Request, State},
    http::{header, request::Parts, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::{rngs::OsRng, RngCore};
use rsa::{pkcs8::DecodePublicKey, traits::PublicKeyParts, RsaPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use tracing::warn;
use uuid::Uuid;

use crate::{config::AuthConfig, state::AppState};

const ACCESS_TOKEN_SCOPES: [&str; 5] = [
    "transactions:read",
    "transactions:write",
    "categories:read",
    "categories:write",
    "analytics:read",
];
const REFRESH_COOKIE_NAME: &str = "mony_refresh_token";
const CSRF_COOKIE_NAME: &str = "mony_csrf_token";
const CSRF_HEADER_NAME: &str = "x-csrf-token";

#[derive(Clone)]
pub struct AuthState {
    issuer: String,
    audience: String,
    access_token_ttl_seconds: i64,
    refresh_token_ttl_days: i64,
    secure_cookies: bool,
    key_id: String,
    encoding_key: Arc<EncodingKey>,
    decoding_key: Arc<DecodingKey>,
    jwks: JwksResponse,
}

impl AuthState {
    pub fn new(config: &AuthConfig) -> Result<Self, AuthInitError> {
        let private_key_pem =
            fs::read(&config.jwt_private_key_path).map_err(|source| AuthInitError::KeyRead {
                path: config.jwt_private_key_path.clone(),
                source,
            })?;
        let public_key_pem =
            fs::read(&config.jwt_public_key_path).map_err(|source| AuthInitError::KeyRead {
                path: config.jwt_public_key_path.clone(),
                source,
            })?;

        let encoding_key = EncodingKey::from_rsa_pem(&private_key_pem)
            .map_err(AuthInitError::InvalidPrivateKey)?;
        let decoding_key =
            DecodingKey::from_rsa_pem(&public_key_pem).map_err(AuthInitError::InvalidPublicKey)?;
        let public_key_pem_str =
            String::from_utf8(public_key_pem.clone()).map_err(AuthInitError::InvalidPemUtf8)?;
        let public_key = RsaPublicKey::from_public_key_pem(&public_key_pem_str)
            .map_err(AuthInitError::InvalidJwkKey)?;

        let kid = key_id(&public_key_pem);
        let jwks = JwksResponse {
            keys: vec![JwkKey {
                kty: "RSA".to_string(),
                alg: "RS256".to_string(),
                use_: "sig".to_string(),
                kid: kid.clone(),
                n: URL_SAFE_NO_PAD.encode(public_key.n().to_bytes_be()),
                e: URL_SAFE_NO_PAD.encode(public_key.e().to_bytes_be()),
            }],
        };

        Ok(Self {
            issuer: config.issuer.clone(),
            audience: config.audience.clone(),
            access_token_ttl_seconds: config.access_token_ttl_seconds,
            refresh_token_ttl_days: config.refresh_token_ttl_days,
            secure_cookies: config.secure_cookies,
            key_id: kid,
            encoding_key: Arc::new(encoding_key),
            decoding_key: Arc::new(decoding_key),
            jwks,
        })
    }

    pub fn bootstrap_status(&self) -> PublicBootstrapStatus {
        PublicBootstrapStatus {
            refresh_cookie_name: REFRESH_COOKIE_NAME,
            csrf_cookie_name: CSRF_COOKIE_NAME,
        }
    }

    pub fn jwks(&self) -> &JwksResponse {
        &self.jwks
    }

    pub fn issue_access_token(
        &self,
        user_id: Uuid,
        session_id: Uuid,
        username: &str,
        scopes: &[String],
    ) -> Result<(String, i64), AuthError> {
        let now = Utc::now();
        let expires_at = now + Duration::seconds(self.access_token_ttl_seconds);
        let claims = AccessTokenClaims {
            iss: self.issuer.clone(),
            aud: self.audience.clone(),
            sub: user_id.to_string(),
            preferred_username: username.to_owned(),
            jti: Uuid::now_v7().to_string(),
            sid: session_id.to_string(),
            scope: scopes.join(" "),
            iat: now.timestamp(),
            nbf: now.timestamp(),
            exp: expires_at.timestamp(),
        };

        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(self.key_id.clone());

        let token = encode(&header, &claims, &self.encoding_key)
            .map_err(|error| AuthError::TokenEncoding(error.to_string()))?;

        Ok((token, self.access_token_ttl_seconds))
    }

    pub fn verify_access_token(&self, token: &str) -> Result<AuthenticatedUser, AuthError> {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(std::slice::from_ref(&self.audience));
        validation.set_issuer(std::slice::from_ref(&self.issuer));
        validation.validate_exp = true;
        validation.validate_nbf = true;

        let claims = decode::<AccessTokenClaims>(token, &self.decoding_key, &validation)
            .map_err(|_| AuthError::Unauthorized("invalid access token".to_string()))?
            .claims;

        Ok(AuthenticatedUser {
            user_id: Uuid::parse_str(&claims.sub)
                .map_err(|_| AuthError::Unauthorized("invalid subject".to_string()))?,
            session_id: Uuid::parse_str(&claims.sid)
                .map_err(|_| AuthError::Unauthorized("invalid session".to_string()))?,
            username: claims.preferred_username,
            scopes: claims
                .scope
                .split_whitespace()
                .map(ToOwned::to_owned)
                .collect(),
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthInitError {
    #[error("failed to read key file {path}: {source}")]
    KeyRead {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid private key: {0}")]
    InvalidPrivateKey(jsonwebtoken::errors::Error),
    #[error("invalid public key: {0}")]
    InvalidPublicKey(jsonwebtoken::errors::Error),
    #[error("public key pem is not valid utf-8: {0}")]
    InvalidPemUtf8(std::string::FromUtf8Error),
    #[error("failed to build jwks from public key: {0}")]
    InvalidJwkKey(rsa::pkcs8::spki::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AccessTokenClaims {
    iss: String,
    aud: String,
    sub: String,
    preferred_username: String,
    jti: String,
    sid: String,
    scope: String,
    iat: i64,
    nbf: i64,
    exp: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticatedUser {
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub username: String,
    pub scopes: Vec<String>,
}

impl AuthenticatedUser {
    pub fn require_scope(&self, scope: &str) -> Result<(), AuthError> {
        if self.scopes.iter().any(|existing| existing == scope) {
            Ok(())
        } else {
            Err(AuthError::Forbidden(format!("missing scope {scope}")))
        }
    }
}

impl<S> FromRequestParts<S> for AuthenticatedUser
where
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthenticatedUser>()
            .cloned()
            .ok_or_else(|| AuthError::Unauthorized("missing authenticated user".to_string()))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Internal(String),
    #[error("{0}")]
    TokenEncoding(String),
}

impl AuthError {
    fn status_code(&self) -> StatusCode {
        match self {
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Internal(_) | Self::TokenEncoding(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        (self.status_code(), self.to_string()).into_response()
    }
}

#[derive(Debug, Deserialize)]
pub struct BootstrapRequest {
    pub username: String,
    pub password: String,
    pub device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    pub device_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthUserResponse {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct AuthSessionResponse {
    pub id: String,
    pub device_name: Option<String>,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct AuthTokenPairResponse {
    pub access_token: String,
    pub token_type: &'static str,
    pub expires_in: i64,
    pub scopes: Vec<String>,
    pub user: AuthUserResponse,
    pub session: AuthSessionResponse,
}

#[derive(Debug, Serialize)]
pub struct AuthSessionViewResponse {
    pub user: AuthUserResponse,
    pub scopes: Vec<String>,
    pub session_id: String,
}

#[derive(Debug, Serialize)]
pub struct BootstrapStatusResponse {
    pub bootstrap_required: bool,
    pub refresh_cookie_name: &'static str,
    pub csrf_cookie_name: &'static str,
}

#[derive(Debug, Serialize)]
pub struct LogoutResponse {
    pub message: &'static str,
}

#[derive(Debug, Serialize)]
pub struct SessionListResponse {
    pub items: Vec<AuthSessionResponse>,
}

#[derive(Debug, Serialize)]
pub struct PublicBootstrapStatus {
    pub refresh_cookie_name: &'static str,
    pub csrf_cookie_name: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct JwksResponse {
    pub keys: Vec<JwkKey>,
}

#[derive(Debug, Clone, Serialize)]
pub struct JwkKey {
    pub kty: String,
    pub alg: String,
    #[serde(rename = "use")]
    pub use_: String,
    pub kid: String,
    pub n: String,
    pub e: String,
}

#[derive(Debug, FromRow)]
struct UserRecord {
    id: Uuid,
    username: String,
    password_hash: String,
}

#[derive(Debug, FromRow)]
struct SessionRecord {
    id: Uuid,
    user_id: Uuid,
    device_name: Option<String>,
    ip_address: Option<String>,
    user_agent: Option<String>,
    created_at: DateTime<Utc>,
    last_active_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct RefreshTokenRecord {
    id: Uuid,
    session_id: Uuid,
    token_hash: String,
    family_id: Uuid,
    expires_at: DateTime<Utc>,
    used_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    session_revoked_at: Option<DateTime<Utc>>,
    user_id: Uuid,
    username: String,
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AuthError> {
    let bearer = extract_bearer(request.headers())?;
    let principal = state.auth.verify_access_token(bearer)?;
    request.extensions_mut().insert(principal);
    Ok(next.run(request).await)
}

pub async fn jwks(State(state): State<AppState>) -> Json<JwksResponse> {
    Json(state.auth.jwks().clone())
}

pub async fn bootstrap_status(
    State(state): State<AppState>,
) -> Result<Json<BootstrapStatusResponse>, AuthError> {
    let bootstrap_required = count_users(&state.db).await? == 0;
    let public = state.auth.bootstrap_status();

    Ok(Json(BootstrapStatusResponse {
        bootstrap_required,
        refresh_cookie_name: public.refresh_cookie_name,
        csrf_cookie_name: public.csrf_cookie_name,
    }))
}

pub async fn bootstrap(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BootstrapRequest>,
) -> Result<(HeaderMap, Json<AuthTokenPairResponse>), AuthError> {
    if count_users(&state.db).await? > 0 {
        return Err(AuthError::Conflict(
            "bootstrap is disabled after the first account is created".to_string(),
        ));
    }

    let username = normalize_username(&payload.username)?;
    validate_password(&payload.password)?;
    let password_hash = hash_password(&payload.password)?;
    let context = request_context(&headers, payload.device_name);

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let user_id = Uuid::now_v7();
    sqlx::query("INSERT INTO auth_user (id, username, password_hash) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(&username)
        .bind(&password_hash)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let user = UserRecord {
        id: user_id,
        username,
        password_hash,
    };
    let session = create_session(&mut tx, &user, &context).await?;
    log_auth_event(
        &mut tx,
        Some(user.id),
        Some(session.id),
        "bootstrap",
        context.ip_address.as_deref(),
        json!({ "device_name": context.device_name }),
    )
    .await?;

    let response = issue_token_pair(&state.auth, &mut tx, &user, &session).await?;
    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(response)
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthTokenPairResponse>), AuthError> {
    let username = normalize_username(&payload.username)?;
    let user = find_user_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AuthError::Unauthorized("invalid credentials".to_string()))?;

    verify_password(&payload.password, &user.password_hash)
        .map_err(|_| AuthError::Unauthorized("invalid credentials".to_string()))?;

    let context = request_context(&headers, payload.device_name);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    let session = create_session(&mut tx, &user, &context).await?;
    log_auth_event(
        &mut tx,
        Some(user.id),
        Some(session.id),
        "login",
        context.ip_address.as_deref(),
        json!({ "device_name": context.device_name }),
    )
    .await?;

    let response = issue_token_pair(&state.auth, &mut tx, &user, &session).await?;
    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(response)
}

pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<AuthTokenPairResponse>), AuthError> {
    require_csrf(&headers)?;
    let refresh_token = extract_cookie(&headers, REFRESH_COOKIE_NAME)
        .ok_or_else(|| AuthError::Unauthorized("missing refresh token".to_string()))?;
    let token_hash = hash_token(&refresh_token);

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let record = sqlx::query_as::<_, RefreshTokenRecord>(
        r#"
        SELECT
            rt.id,
            rt.session_id,
            rt.token_hash,
            rt.family_id,
            rt.expires_at,
            rt.used_at,
            rt.created_at,
            s.revoked_at AS session_revoked_at,
            s.user_id,
            u.username
        FROM auth_refresh_token rt
        INNER JOIN auth_session s ON s.id = rt.session_id
        INNER JOIN auth_user u ON u.id = s.user_id
        WHERE rt.token_hash = $1
        FOR UPDATE
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?
    .ok_or_else(|| AuthError::Unauthorized("invalid refresh token".to_string()))?;

    let now = Utc::now();
    if record.session_revoked_at.is_some() || record.expires_at <= now {
        return Err(AuthError::Unauthorized("refresh token expired".to_string()));
    }

    if record.used_at.is_some() {
        revoke_session_inner(&mut tx, record.session_id).await?;
        log_auth_event(
            &mut tx,
            Some(record.user_id),
            Some(record.session_id),
            "token_theft_detected",
            request_ip_address(&headers).as_deref(),
            json!({ "family_id": record.family_id, "refresh_token_id": record.id }),
        )
        .await?;
        tx.commit()
            .await
            .map_err(|error| AuthError::Internal(error.to_string()))?;
        return Err(AuthError::Unauthorized(
            "refresh token reuse detected; session revoked".to_string(),
        ));
    }

    sqlx::query("UPDATE auth_refresh_token SET used_at = NOW() WHERE id = $1")
        .bind(record.id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    sqlx::query("UPDATE auth_session SET last_active_at = NOW() WHERE id = $1")
        .bind(record.session_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let session = get_session(&mut tx, record.session_id).await?;
    let user = UserRecord {
        id: record.user_id,
        username: record.username,
        password_hash: String::new(),
    };
    let response =
        rotate_token_pair(&state.auth, &mut tx, &user, &session, record.family_id).await?;
    log_auth_event(
        &mut tx,
        Some(user.id),
        Some(session.id),
        "token_refresh",
        request_ip_address(&headers).as_deref(),
        json!({ "refresh_token_id": record.id, "previous_token_hash": record.token_hash, "created_at": record.created_at }),
    )
    .await?;

    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(response)
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthenticatedUser,
) -> Result<(HeaderMap, Json<LogoutResponse>), AuthError> {
    require_csrf(&headers)?;
    revoke_session(
        &state.db,
        auth.session_id,
        Some(auth.user_id),
        request_ip_address(&headers),
    )
    .await?;

    Ok((
        clear_auth_cookie_headers(state.auth.secure_cookies),
        Json(LogoutResponse {
            message: "session revoked",
        }),
    ))
}

pub async fn logout_all(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthenticatedUser,
) -> Result<(HeaderMap, Json<LogoutResponse>), AuthError> {
    require_csrf(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    sqlx::query(
        "UPDATE auth_session SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;
    log_auth_event(
        &mut tx,
        Some(auth.user_id),
        Some(auth.session_id),
        "logout_all",
        request_ip_address(&headers).as_deref(),
        json!({}),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok((
        clear_auth_cookie_headers(state.auth.secure_cookies),
        Json(LogoutResponse {
            message: "all sessions revoked",
        }),
    ))
}

pub async fn session(auth: AuthenticatedUser) -> Json<AuthSessionViewResponse> {
    Json(AuthSessionViewResponse {
        user: AuthUserResponse {
            id: auth.user_id.to_string(),
            username: auth.username,
        },
        scopes: auth.scopes,
        session_id: auth.session_id.to_string(),
    })
}

pub async fn list_sessions(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<SessionListResponse>, AuthError> {
    let sessions = sqlx::query_as::<_, SessionRecord>(
        r#"
        SELECT id, user_id, device_name, ip_address, user_agent, created_at, last_active_at, revoked_at
        FROM auth_session
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(Json(SessionListResponse {
        items: sessions
            .into_iter()
            .map(AuthSessionResponse::from)
            .collect(),
    }))
}

pub async fn revoke_session_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthenticatedUser,
    Path(session_id): Path<Uuid>,
) -> Result<Json<LogoutResponse>, AuthError> {
    let session_user_id: Option<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM auth_session WHERE id = $1")
            .bind(session_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|error| AuthError::Internal(error.to_string()))?;

    match session_user_id {
        Some(owner_id) if owner_id == auth.user_id => {
            revoke_session(
                &state.db,
                session_id,
                Some(auth.user_id),
                request_ip_address(&headers),
            )
            .await?;
            Ok(Json(LogoutResponse {
                message: "session revoked",
            }))
        }
        Some(_) => Err(AuthError::Forbidden(
            "session does not belong to current user".to_string(),
        )),
        None => Err(AuthError::BadRequest("session not found".to_string())),
    }
}

impl From<SessionRecord> for AuthSessionResponse {
    fn from(value: SessionRecord) -> Self {
        let _ = value.user_id;
        Self {
            id: value.id.to_string(),
            device_name: value.device_name,
            user_agent: value.user_agent,
            ip_address: value.ip_address,
            created_at: value.created_at,
            last_active_at: value.last_active_at,
            revoked_at: value.revoked_at,
        }
    }
}

async fn find_user_by_username(
    pool: &PgPool,
    username: &str,
) -> Result<Option<UserRecord>, AuthError> {
    sqlx::query_as::<_, UserRecord>(
        "SELECT id, username, password_hash FROM auth_user WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))
}

async fn count_users(pool: &PgPool) -> Result<i64, AuthError> {
    sqlx::query_scalar("SELECT COUNT(*) FROM auth_user")
        .fetch_one(pool)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))
}

async fn create_session(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user: &UserRecord,
    context: &RequestContext,
) -> Result<SessionRecord, AuthError> {
    let session = SessionRecord {
        id: Uuid::now_v7(),
        user_id: user.id,
        device_name: context.device_name.clone(),
        ip_address: context.ip_address.clone(),
        user_agent: context.user_agent.clone(),
        created_at: Utc::now(),
        last_active_at: Utc::now(),
        revoked_at: None,
    };

    sqlx::query(
        r#"
        INSERT INTO auth_session (id, user_id, device_name, ip_address, user_agent, created_at, last_active_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(session.id)
    .bind(session.user_id)
    .bind(&session.device_name)
    .bind(&session.ip_address)
    .bind(&session.user_agent)
    .bind(session.created_at)
    .bind(session.last_active_at)
    .execute(&mut **tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(session)
}

async fn get_session(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    session_id: Uuid,
) -> Result<SessionRecord, AuthError> {
    sqlx::query_as::<_, SessionRecord>(
        r#"
        SELECT id, user_id, device_name, ip_address, user_agent, created_at, last_active_at, revoked_at
        FROM auth_session
        WHERE id = $1
        "#,
    )
    .bind(session_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))
}

async fn issue_token_pair(
    auth: &AuthState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user: &UserRecord,
    session: &SessionRecord,
) -> Result<(HeaderMap, Json<AuthTokenPairResponse>), AuthError> {
    let family_id = Uuid::now_v7();
    rotate_token_pair(auth, tx, user, session, family_id).await
}

async fn rotate_token_pair(
    auth: &AuthState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user: &UserRecord,
    session: &SessionRecord,
    family_id: Uuid,
) -> Result<(HeaderMap, Json<AuthTokenPairResponse>), AuthError> {
    let refresh_token = random_token(48);
    let csrf_token = random_token(24);
    let refresh_token_hash = hash_token(&refresh_token);
    let expires_at = Utc::now() + Duration::days(auth.refresh_token_ttl_days);
    let refresh_token_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO auth_refresh_token (id, session_id, token_hash, family_id, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(refresh_token_id)
    .bind(session.id)
    .bind(refresh_token_hash)
    .bind(family_id)
    .bind(expires_at)
    .execute(&mut **tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;

    let scopes: Vec<String> = ACCESS_TOKEN_SCOPES
        .iter()
        .map(|scope| (*scope).to_owned())
        .collect();
    let (access_token, expires_in) =
        auth.issue_access_token(user.id, session.id, &user.username, &scopes)?;

    let mut headers = HeaderMap::new();
    append_cookie_header(
        &mut headers,
        refresh_cookie_header(
            &refresh_token,
            auth.refresh_token_ttl_days,
            auth.secure_cookies,
        ),
    )?;
    append_cookie_header(
        &mut headers,
        csrf_cookie_header(
            &csrf_token,
            auth.refresh_token_ttl_days,
            auth.secure_cookies,
        ),
    )?;

    Ok((
        headers,
        Json(AuthTokenPairResponse {
            access_token,
            token_type: "Bearer",
            expires_in,
            scopes,
            user: AuthUserResponse {
                id: user.id.to_string(),
                username: user.username.clone(),
            },
            session: AuthSessionResponse::from(SessionRecord {
                id: session.id,
                user_id: session.user_id,
                device_name: session.device_name.clone(),
                ip_address: session.ip_address.clone(),
                user_agent: session.user_agent.clone(),
                created_at: session.created_at,
                last_active_at: session.last_active_at,
                revoked_at: session.revoked_at,
            }),
        }),
    ))
}

async fn revoke_session(
    pool: &PgPool,
    session_id: Uuid,
    user_id: Option<Uuid>,
    ip_address: Option<String>,
) -> Result<(), AuthError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    revoke_session_inner(&mut tx, session_id).await?;
    log_auth_event(
        &mut tx,
        user_id,
        Some(session_id),
        "logout",
        ip_address.as_deref(),
        json!({}),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))
}

async fn revoke_session_inner(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    session_id: Uuid,
) -> Result<(), AuthError> {
    sqlx::query("UPDATE auth_session SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL")
        .bind(session_id)
        .execute(&mut **tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    Ok(())
}

async fn log_auth_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Option<Uuid>,
    session_id: Option<Uuid>,
    event_type: &str,
    ip_address: Option<&str>,
    metadata: serde_json::Value,
) -> Result<(), AuthError> {
    sqlx::query(
        r#"
        INSERT INTO auth_event (id, user_id, session_id, event_type, ip_address, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(session_id)
    .bind(event_type)
    .bind(ip_address)
    .bind(metadata)
    .execute(&mut **tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;
    Ok(())
}

fn normalize_username(input: &str) -> Result<String, AuthError> {
    let username = input.trim().to_ascii_lowercase();
    let is_valid = !username.is_empty()
        && username.len() >= 3
        && username.len() <= 64
        && username.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '@')
        });

    if !is_valid {
        return Err(AuthError::BadRequest(
            "username must be 3 to 64 characters and use only letters, numbers, '.', '_', '-', or '@'"
                .to_string(),
        ));
    }

    Ok(username)
}

fn validate_password(password: &str) -> Result<(), AuthError> {
    if password.trim().len() < 12 {
        return Err(AuthError::BadRequest(
            "password must be at least 12 characters long".to_string(),
        ));
    }
    Ok(())
}

fn hash_password(password: &str) -> Result<String, AuthError> {
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| AuthError::Internal(error.to_string()))
}

fn verify_password(password: &str, password_hash: &str) -> Result<(), AuthError> {
    let parsed_hash =
        PasswordHash::new(password_hash).map_err(|error| AuthError::Internal(error.to_string()))?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AuthError::Unauthorized("invalid credentials".to_string()))
}

fn random_token(size: usize) -> String {
    let mut bytes = vec![0_u8; size];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn key_id(public_key_pem: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(public_key_pem);
    hex::encode(hasher.finalize())[..16].to_owned()
}

fn request_context(headers: &HeaderMap, device_name: Option<String>) -> RequestContext {
    RequestContext {
        device_name: device_name
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        ip_address: request_ip_address(headers),
        user_agent: headers
            .get(header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned),
    }
}

fn request_ip_address(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn extract_bearer(headers: &HeaderMap) -> Result<&str, AuthError> {
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AuthError::Unauthorized("missing bearer token".to_string()))?;

    authorization
        .strip_prefix("Bearer ")
        .ok_or_else(|| AuthError::Unauthorized("invalid authorization header".to_string()))
}

fn require_csrf(headers: &HeaderMap) -> Result<(), AuthError> {
    let header_token = headers
        .get(CSRF_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AuthError::Unauthorized("missing csrf token".to_string()))?;
    let cookie_token = extract_cookie(headers, CSRF_COOKIE_NAME)
        .ok_or_else(|| AuthError::Unauthorized("missing csrf cookie".to_string()))?;

    if header_token != cookie_token {
        return Err(AuthError::Unauthorized(
            "csrf validation failed".to_string(),
        ));
    }

    Ok(())
}

fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie_header.split(';').find_map(|entry| {
        let mut parts = entry.trim().splitn(2, '=');
        let key = parts.next()?.trim();
        let value = parts.next()?.trim();
        (key == name).then(|| value.to_owned())
    })
}

fn append_cookie_header(headers: &mut HeaderMap, cookie_value: String) -> Result<(), AuthError> {
    let value = HeaderValue::from_str(&cookie_value)
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    headers.append(header::SET_COOKIE, value);
    Ok(())
}

fn refresh_cookie_header(value: &str, days: i64, secure: bool) -> String {
    format!(
        "{REFRESH_COOKIE_NAME}={value}; Path=/; Max-Age={}; HttpOnly; SameSite=Strict{}",
        days * 24 * 60 * 60,
        secure_flag(secure)
    )
}

fn csrf_cookie_header(value: &str, days: i64, secure: bool) -> String {
    format!(
        "{CSRF_COOKIE_NAME}={value}; Path=/; Max-Age={}; SameSite=Strict{}",
        days * 24 * 60 * 60,
        secure_flag(secure)
    )
}

fn clear_auth_cookie_headers(secure: bool) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for cookie in [
        format!(
            "{REFRESH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict{}",
            secure_flag(secure)
        ),
        format!(
            "{CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict{}",
            secure_flag(secure)
        ),
    ] {
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            headers.append(header::SET_COOKIE, value);
        } else {
            warn!("failed to build clearing auth cookie header");
        }
    }
    headers
}

fn secure_flag(secure: bool) -> &'static str {
    if secure {
        "; Secure"
    } else {
        ""
    }
}

#[derive(Debug)]
struct RequestContext {
    device_name: Option<String>,
    ip_address: Option<String>,
    user_agent: Option<String>,
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::{AuthConfig, AuthState};
    use rsa::{
        pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
        RsaPrivateKey, RsaPublicKey,
    };

    const TEST_PRIVATE_KEY_PATH: &str = "/tmp/mony-test-private.pem";
    const TEST_PUBLIC_KEY_PATH: &str = "/tmp/mony-test-public.pem";

    pub(crate) fn public_key_pem() -> String {
        let private_key = RsaPrivateKey::new(&mut rand::thread_rng(), 2048)
            .expect("test rsa key should generate");
        let public_key = RsaPublicKey::from(&private_key);
        let private_key_pem = private_key
            .to_pkcs8_pem(LineEnding::LF)
            .expect("private key pem should serialize");
        let public_key_pem = public_key
            .to_public_key_pem(LineEnding::LF)
            .expect("public key pem should serialize");

        std::fs::write(TEST_PRIVATE_KEY_PATH, private_key_pem.as_bytes())
            .expect("private key should write");
        std::fs::write(TEST_PUBLIC_KEY_PATH, public_key_pem.as_bytes())
            .expect("public key should write");

        public_key_pem.to_string()
    }

    pub(crate) fn auth_state() -> AuthState {
        let _ = public_key_pem();

        AuthState::new(&AuthConfig {
            issuer: "mony-test".to_string(),
            audience: "mony-api".to_string(),
            jwt_private_key_path: TEST_PRIVATE_KEY_PATH.to_string(),
            jwt_public_key_path: TEST_PUBLIC_KEY_PATH.to_string(),
            access_token_ttl_seconds: 300,
            refresh_token_ttl_days: 30,
            secure_cookies: false,
        })
        .expect("auth state should initialize")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_cookie_header, clear_auth_cookie_headers, extract_cookie, hash_token, key_id,
        require_csrf,
    };
    use axum::{
        body::Body,
        http::{header, HeaderMap, Request, StatusCode},
        middleware,
        routing::get,
        Router,
    };
    use tower::util::ServiceExt;

    #[test]
    fn access_token_round_trip_succeeds() {
        let auth = crate::auth::test_support::auth_state();
        let (token, _) = auth
            .issue_access_token(
                uuid::Uuid::nil(),
                uuid::Uuid::nil(),
                "owner",
                &["transactions:read".to_string()],
            )
            .expect("token should issue");
        let principal = auth
            .verify_access_token(&token)
            .expect("token should verify");

        assert_eq!(principal.username, "owner");
        assert_eq!(principal.scopes, vec!["transactions:read"]);
    }

    #[test]
    fn csrf_requires_matching_header_and_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, "mony_csrf_token=abc123".parse().unwrap());
        headers.insert("x-csrf-token", "abc123".parse().unwrap());

        assert!(require_csrf(&headers).is_ok());
    }

    #[test]
    fn csrf_rejects_mismatch() {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, "mony_csrf_token=abc123".parse().unwrap());
        headers.insert("x-csrf-token", "zzz".parse().unwrap());

        assert!(require_csrf(&headers).is_err());
    }

    #[test]
    fn cookie_extraction_reads_named_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            "other=value; mony_refresh_token=secret-token"
                .parse()
                .unwrap(),
        );

        assert_eq!(
            extract_cookie(&headers, "mony_refresh_token").as_deref(),
            Some("secret-token")
        );
    }

    #[test]
    fn hashing_is_deterministic() {
        assert_eq!(hash_token("abc"), hash_token("abc"));
        assert_ne!(hash_token("abc"), hash_token("def"));
    }

    #[test]
    fn key_ids_are_stable() {
        let public_key_pem = crate::auth::test_support::public_key_pem();
        assert_eq!(
            key_id(public_key_pem.as_bytes()),
            key_id(public_key_pem.as_bytes())
        );
    }

    #[tokio::test]
    async fn middleware_rejects_missing_bearer_token() {
        let auth = crate::auth::test_support::auth_state();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://mony:mony@127.0.0.1:5432/mony")
            .expect("lazy pool should initialize");
        let state = crate::state::AppState { db: pool, auth };
        let app = Router::new()
            .route("/private", get(|| async { StatusCode::OK }))
            .route_layer(middleware::from_fn_with_state(
                state.clone(),
                crate::auth::require_auth,
            ))
            .with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/private")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn clear_cookie_headers_include_both_auth_cookies() {
        let headers = clear_auth_cookie_headers(false);
        let values: Vec<_> = headers.get_all(header::SET_COOKIE).iter().collect();
        assert_eq!(values.len(), 2);
    }

    #[test]
    fn append_cookie_header_appends_multiple_values() {
        let mut headers = HeaderMap::new();
        append_cookie_header(&mut headers, "a=b; Path=/".to_string()).unwrap();
        append_cookie_header(&mut headers, "c=d; Path=/".to_string()).unwrap();
        assert_eq!(headers.get_all(header::SET_COOKIE).iter().count(), 2);
    }
}
