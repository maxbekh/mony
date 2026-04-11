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
use webauthn_rs::prelude::*;

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
const WEBAUTHN_STATE_TTL_MINUTES: i64 = 10;

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
    webauthn: Arc<Webauthn>,
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
        let rp_origin = Url::parse(&config.webauthn_rp_origin)
            .map_err(AuthInitError::InvalidWebauthnOrigin)?;
        let webauthn = WebauthnBuilder::new(&config.webauthn_rp_id, &rp_origin)
            .map_err(AuthInitError::InvalidWebauthnConfiguration)?
            .rp_name(&config.webauthn_rp_name)
            .build()
            .map_err(AuthInitError::InvalidWebauthnConfiguration)?;
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
            webauthn: Arc::new(webauthn),
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

    pub fn webauthn(&self) -> &Webauthn {
        &self.webauthn
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
    #[error("invalid webauthn rp origin: {0}")]
    InvalidWebauthnOrigin(url::ParseError),
    #[error("invalid webauthn configuration: {0}")]
    InvalidWebauthnConfiguration(WebauthnError),
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

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct PasskeyRegistrationStartRequest {
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PasskeyRegistrationFinishRequest {
    pub ceremony_id: String,
    pub credential: RegisterPublicKeyCredential,
}

#[derive(Debug, Deserialize)]
pub struct PasskeyAuthenticationStartRequest {
    pub username: Option<String>,
    pub device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PasskeyAuthenticationFinishRequest {
    pub ceremony_id: String,
    pub credential: PublicKeyCredential,
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

#[derive(Debug, Deserialize)]
pub struct AuthEventListParams {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct AuthEventResponse {
    pub id: String,
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    pub event_type: String,
    pub ip_address: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct AuthEventListResponse {
    pub items: Vec<AuthEventResponse>,
}

#[derive(Debug, Serialize)]
pub struct PasskeyResponse {
    pub id: String,
    pub label: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct PasskeyListResponse {
    pub items: Vec<PasskeyResponse>,
}

#[derive(Debug, Serialize)]
pub struct PasskeyRegistrationStartResponse {
    pub ceremony_id: String,
    pub options: CreationChallengeResponse,
}

#[derive(Debug, Serialize)]
pub struct PasskeyAuthenticationStartResponse {
    pub ceremony_id: String,
    pub options: RequestChallengeResponse,
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
    #[allow(dead_code)]
    ai_settings: serde_json::Value,
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

#[derive(Debug, FromRow)]
struct AuthEventRecord {
    id: Uuid,
    user_id: Option<Uuid>,
    session_id: Option<Uuid>,
    event_type: String,
    ip_address: Option<String>,
    metadata: serde_json::Value,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct PasskeyRecord {
    id: Uuid,
    user_id: Uuid,
    label: String,
    credential_id: String,
    credential: serde_json::Value,
    created_at: DateTime<Utc>,
    last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct RegistrationCeremonyRecord {
    id: Uuid,
    label: String,
    state: serde_json::Value,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct AuthenticationCeremonyRecord {
    id: Uuid,
    user_id: Option<Uuid>,
    device_name: Option<String>,
    state: serde_json::Value,
    expires_at: DateTime<Utc>,
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
        ai_settings: json!({}),
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
    let user = match find_user_by_username(&state.db, &username).await? {
        Some(user) => user,
        None => {
            log_auth_failure(&state.db, &headers, "login_failed", &username, None).await?;
            return Err(AuthError::Unauthorized("invalid credentials".to_string()));
        }
    };

    if verify_password(&payload.password, &user.password_hash).is_err() {
        log_auth_failure(
            &state.db,
            &headers,
            "login_failed",
            &username,
            Some(user.id),
        )
        .await?;
        return Err(AuthError::Unauthorized("invalid credentials".to_string()));
    }

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
        ai_settings: json!({}),
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

pub async fn change_password(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<(HeaderMap, Json<LogoutResponse>), AuthError> {
    validate_password(&payload.new_password)?;
    if payload.current_password == payload.new_password {
        return Err(AuthError::BadRequest(
            "new password must be different from the current password".to_string(),
        ));
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    let user = find_user_by_id(&mut tx, auth.user_id).await?;

    verify_password(&payload.current_password, &user.password_hash)
        .map_err(|_| AuthError::Unauthorized("invalid current password".to_string()))?;

    let password_hash = hash_password(&payload.new_password)?;
    sqlx::query("UPDATE auth_user SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(password_hash)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    revoke_all_sessions_for_user(&mut tx, auth.user_id).await?;
    log_auth_event(
        &mut tx,
        Some(auth.user_id),
        Some(auth.session_id),
        "password_changed",
        None,
        json!({}),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok((
        clear_auth_cookie_headers(state.auth.secure_cookies),
        Json(LogoutResponse {
            message: "password updated; sign in again",
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

pub async fn list_auth_events(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    axum::extract::Query(params): axum::extract::Query<AuthEventListParams>,
) -> Result<Json<AuthEventListResponse>, AuthError> {
    let limit = params.limit.unwrap_or(25).clamp(1, 100);
    let events = sqlx::query_as::<_, AuthEventRecord>(
        r#"
        SELECT id, user_id, session_id, event_type, ip_address, metadata, created_at
        FROM auth_event
        WHERE user_id = $1 OR (user_id IS NULL AND metadata->>'username' = $2)
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(auth.user_id)
    .bind(&auth.username)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(Json(AuthEventListResponse {
        items: events.into_iter().map(AuthEventResponse::from).collect(),
    }))
}

pub async fn list_passkeys(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<PasskeyListResponse>, AuthError> {
    let passkeys = sqlx::query_as::<_, PasskeyRecord>(
        r#"
        SELECT id, user_id, label, credential_id, credential, created_at, last_used_at
        FROM auth_passkey
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(Json(PasskeyListResponse {
        items: passkeys.into_iter().map(PasskeyResponse::from).collect(),
    }))
}

pub async fn start_passkey_registration(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(payload): Json<PasskeyRegistrationStartRequest>,
) -> Result<Json<PasskeyRegistrationStartResponse>, AuthError> {
    let label = sanitize_passkey_label(payload.label)?;
    tracing::debug!(?auth.user_id, ?label, "starting passkey registration");
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    cleanup_expired_webauthn_state(&mut tx).await?;
    sqlx::query("DELETE FROM auth_webauthn_registration WHERE user_id = $1")
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let user = find_user_by_id(&mut tx, auth.user_id).await?;
    let existing = list_passkey_records_by_user(&mut tx, auth.user_id).await?;
    let exclude_credentials = existing
        .iter()
        .map(|record| record.passkey())
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|passkey| passkey.cred_id().clone())
        .collect::<Vec<_>>();
    let exclude_credentials = (!exclude_credentials.is_empty()).then_some(exclude_credentials);

    tracing::debug!(?exclude_credentials, "webauthn exclude_credentials");

    let (options, ceremony_state) = state
        .auth
        .webauthn()
        .start_passkey_registration(auth.user_id, &user.username, &user.username, exclude_credentials)
        .map_err(|error| {
            tracing::error!(?error, "webauthn start_passkey_registration failed");
            map_webauthn_error(error)
        })?;

    tracing::debug!(?options, "webauthn creation options generated");

    let ceremony_id = Uuid::now_v7();
    let expires_at = Utc::now() + Duration::minutes(WEBAUTHN_STATE_TTL_MINUTES);
    sqlx::query(
        r#"
        INSERT INTO auth_webauthn_registration (id, user_id, label, state, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(ceremony_id)
    .bind(auth.user_id)
    .bind(&label)
    .bind(serde_json::to_value(&ceremony_state).map_err(|error| AuthError::Internal(error.to_string()))?)
    .bind(expires_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;

    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(Json(PasskeyRegistrationStartResponse {
        ceremony_id: ceremony_id.to_string(),
        options,
    }))
}

pub async fn finish_passkey_registration(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthenticatedUser,
    Json(payload): Json<PasskeyRegistrationFinishRequest>,
) -> Result<Json<PasskeyResponse>, AuthError> {
    let ceremony_id = parse_uuid(&payload.ceremony_id, "invalid ceremony id")?;
    tracing::debug!(?ceremony_id, "finishing passkey registration");
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let record = sqlx::query_as::<_, RegistrationCeremonyRecord>(
        r#"
        SELECT id, label, state, expires_at
        FROM auth_webauthn_registration
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
        "#,
    )
    .bind(ceremony_id)
    .bind(auth.user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?
    .ok_or_else(|| AuthError::BadRequest("registration ceremony not found".to_string()))?;

    sqlx::query("DELETE FROM auth_webauthn_registration WHERE id = $1")
        .bind(record.id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    if record.expires_at <= Utc::now() {
        return Err(AuthError::BadRequest(
            "registration ceremony expired; try again".to_string(),
        ));
    }

    let ceremony_state: PasskeyRegistration = serde_json::from_value(record.state)
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let passkey = state
        .auth
        .webauthn()
        .finish_passkey_registration(&payload.credential, &ceremony_state)
        .map_err(|error| {
            tracing::error!(?error, "finish_passkey_registration webauthn validation failed");
            map_webauthn_error(error)
        })?;
    let credential_id = credential_id_string(passkey.cred_id());
    let passkey_id = Uuid::now_v7();

    sqlx::query(
        r#"
        INSERT INTO auth_passkey (id, user_id, label, credential_id, credential, last_used_at, last_used_session_id)
        VALUES ($1, $2, $3, $4, $5, NULL, NULL)
        "#,
    )
    .bind(passkey_id)
    .bind(auth.user_id)
    .bind(&record.label)
    .bind(&credential_id)
    .bind(serde_json::to_value(&passkey).map_err(|error| AuthError::Internal(error.to_string()))?)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        if let Some(db_error) = error.as_database_error() {
            if db_error.is_unique_violation() {
                return AuthError::Conflict("passkey is already registered".to_string());
            }
        }
        AuthError::Internal(error.to_string())
    })?;

    log_auth_event(
        &mut tx,
        Some(auth.user_id),
        Some(auth.session_id),
        "passkey_registered",
        request_ip_address(&headers).as_deref(),
        json!({ "label": record.label, "credential_id": credential_id }),
    )
    .await?;

    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(Json(PasskeyResponse {
        id: passkey_id.to_string(),
        label: record.label,
        created_at: Utc::now(),
        last_used_at: None,
    }))
}

pub async fn start_passkey_authentication(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PasskeyAuthenticationStartRequest>,
) -> Result<Json<PasskeyAuthenticationStartResponse>, AuthError> {
    let mut maybe_user_id = None;
    let credentials = if let Some(raw_username) = payload.username {
        let username = normalize_username(&raw_username)?;
        tracing::debug!(?username, "starting passkey authentication for specific user");
        let user = match find_user_by_username(&state.db, &username).await? {
            Some(user) => user,
            None => {
                log_auth_failure(&state.db, &headers, "passkey_login_failed", &username, None).await?;
                return Err(AuthError::Unauthorized("invalid credentials".to_string()));
            }
        };

        maybe_user_id = Some(user.id);
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|error| AuthError::Internal(error.to_string()))?;

        cleanup_expired_webauthn_state(&mut tx).await?;
        sqlx::query("DELETE FROM auth_webauthn_authentication WHERE user_id = $1")
            .bind(user.id)
            .execute(&mut *tx)
            .await
            .map_err(|error| AuthError::Internal(error.to_string()))?;

        let passkeys = list_passkey_records_by_user(&mut tx, user.id).await?;
        let creds = passkeys
            .iter()
            .map(|record| record.passkey())
            .collect::<Result<Vec<_>, _>>()?;

        if creds.is_empty() {
            tracing::debug!(?username, "no passkeys found for user");
            tx.rollback()
                .await
                .map_err(|error| AuthError::Internal(error.to_string()))?;
            log_auth_failure(
                &state.db,
                &headers,
                "passkey_login_failed",
                &username,
                Some(user.id),
            )
            .await?;
            return Err(AuthError::Unauthorized("invalid credentials".to_string()));
        }
        tx.commit()
            .await
            .map_err(|error| AuthError::Internal(error.to_string()))?;
        creds
    } else {
        tracing::debug!("starting discoverable passkey authentication");
        Vec::new()
    };

    let context = request_context(&headers, payload.device_name);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    cleanup_expired_webauthn_state(&mut tx).await?;

    let (options, ceremony_state) = if maybe_user_id.is_some() {
        let (options, ceremony_state) = state
            .auth
            .webauthn()
            .start_passkey_authentication(&credentials)
            .map_err(|error| {
                tracing::error!(?error, "webauthn start_passkey_authentication failed");
                map_webauthn_error(error)
            })?;
        (
            options,
            serde_json::to_value(&ceremony_state)
                .map_err(|error| AuthError::Internal(error.to_string()))?,
        )
    } else {
        let (options, ceremony_state) = state
            .auth
            .webauthn()
            .start_discoverable_authentication()
            .map_err(|error| {
                tracing::error!(?error, "webauthn start_discoverable_authentication failed");
                map_webauthn_error(error)
            })?;
        (
            options,
            serde_json::to_value(&ceremony_state)
                .map_err(|error| AuthError::Internal(error.to_string()))?,
        )
    };

    tracing::debug!(?options, "webauthn request options generated");

    let ceremony_id = Uuid::now_v7();
    let expires_at = Utc::now() + Duration::minutes(WEBAUTHN_STATE_TTL_MINUTES);
    sqlx::query(
        r#"
        INSERT INTO auth_webauthn_authentication (id, user_id, device_name, state, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(ceremony_id)
    .bind(maybe_user_id)
    .bind(&context.device_name)
    .bind(ceremony_state)
    .bind(expires_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;

    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(Json(PasskeyAuthenticationStartResponse {
        ceremony_id: ceremony_id.to_string(),
        options,
    }))
}

pub async fn finish_passkey_authentication(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PasskeyAuthenticationFinishRequest>,
) -> Result<(HeaderMap, Json<AuthTokenPairResponse>), AuthError> {
    let ceremony_id = parse_uuid(&payload.ceremony_id, "invalid ceremony id")?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let record = sqlx::query_as::<_, AuthenticationCeremonyRecord>(
        r#"
        SELECT id, user_id, device_name, state, expires_at
        FROM auth_webauthn_authentication
        WHERE id = $1
        FOR UPDATE
        "#,
    )
    .bind(ceremony_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?
    .ok_or_else(|| AuthError::BadRequest("authentication ceremony not found".to_string()))?;

    sqlx::query("DELETE FROM auth_webauthn_authentication WHERE id = $1")
        .bind(record.id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    if record.expires_at <= Utc::now() {
        return Err(AuthError::Unauthorized(
            "authentication ceremony expired; try again".to_string(),
        ));
    }

    let (user_id, auth_result) = match record.user_id {
        Some(user_id) => {
            let ceremony_state: PasskeyAuthentication = serde_json::from_value(record.state)
                .map_err(|error| AuthError::Internal(error.to_string()))?;
            let auth_result = state
                .auth
                .webauthn()
                .finish_passkey_authentication(&payload.credential, &ceremony_state)
                .map_err(|error| {
                    tracing::error!(?error, "finish_passkey_authentication webauthn validation failed");
                    AuthError::Unauthorized("invalid credentials".to_string())
                })?;
            (user_id, auth_result)
        }
        None => {
            let ceremony_state: DiscoverableAuthentication =
                serde_json::from_value(record.state)
                    .map_err(|error| AuthError::Internal(error.to_string()))?;
            let (user_id, credential_id) = state
                .auth
                .webauthn()
                .identify_discoverable_authentication(&payload.credential)
                .map_err(|error| {
                    tracing::error!(?error, "identify_discoverable_authentication failed");
                    AuthError::Unauthorized("invalid credentials".to_string())
                })?;

            let passkeys = list_passkey_records_by_user(&mut tx, user_id).await?;
            let matched_credential_id = URL_SAFE_NO_PAD.encode(credential_id);
            if !passkeys
                .iter()
                .any(|record| record.credential_id == matched_credential_id)
            {
                return Err(AuthError::Unauthorized("invalid credentials".to_string()));
            }

            let discoverable_keys = passkeys
                .iter()
                .map(|record| record.passkey().map(DiscoverableKey::from))
                .collect::<Result<Vec<_>, _>>()?;
            let auth_result = state
                .auth
                .webauthn()
                .finish_discoverable_authentication(
                    &payload.credential,
                    ceremony_state,
                    &discoverable_keys,
                )
                .map_err(|error| {
                    tracing::error!(?error, "finish_discoverable_authentication webauthn validation failed");
                    AuthError::Unauthorized("invalid credentials".to_string())
                })?;
            (user_id, auth_result)
        }
    };

    let mut passkeys = list_passkey_records_by_user(&mut tx, user_id).await?;
    if passkeys.is_empty() {
        return Err(AuthError::Unauthorized("invalid credentials".to_string()));
    }

    let matched_credential_id = credential_id_string(auth_result.cred_id());
    for record in &mut passkeys {
        let mut passkey = record.passkey()?;
        if passkey.update_credential(&auth_result).is_some() {
            sqlx::query(
                "UPDATE auth_passkey SET credential = $1 WHERE id = $2",
            )
            .bind(serde_json::to_value(&passkey).map_err(|error| AuthError::Internal(error.to_string()))?)
            .bind(record.id)
            .execute(&mut *tx)
            .await
            .map_err(|error| AuthError::Internal(error.to_string()))?;
        }
    }

    let user = find_user_by_id(&mut tx, user_id).await?;
    let context = request_context(&headers, record.device_name);
    let session = create_session(&mut tx, &user, &context).await?;
    sqlx::query(
        r#"
        UPDATE auth_passkey
        SET last_used_at = NOW(), last_used_session_id = $2
        WHERE user_id = $1 AND credential_id = $3
        "#,
    )
    .bind(user_id)
    .bind(session.id)
    .bind(&matched_credential_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?;
    log_auth_event(
        &mut tx,
        Some(user.id),
        Some(session.id),
        "passkey_login",
        context.ip_address.as_deref(),
        json!({
            "credential_id": matched_credential_id,
            "device_name": context.device_name,
            "user_verified": auth_result.user_verified()
        }),
    )
    .await?;

    let response = issue_token_pair(&state.auth, &mut tx, &user, &session).await?;
    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(response)
}

pub async fn delete_passkey(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthenticatedUser,
    Path(passkey_id): Path<Uuid>,
) -> Result<Json<LogoutResponse>, AuthError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    let record = sqlx::query_as::<_, PasskeyRecord>(
        r#"
        SELECT id, user_id, label, credential_id, credential, created_at, last_used_at
        FROM auth_passkey
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
        "#,
    )
    .bind(passkey_id)
    .bind(auth.user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?
    .ok_or_else(|| AuthError::BadRequest("passkey not found".to_string()))?;

    sqlx::query("DELETE FROM auth_passkey WHERE id = $1")
        .bind(record.id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    log_auth_event(
        &mut tx,
        Some(auth.user_id),
        Some(auth.session_id),
        "passkey_deleted",
        request_ip_address(&headers).as_deref(),
        json!({ "label": record.label, "credential_id": record.credential_id }),
    )
    .await?;

    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;

    Ok(Json(LogoutResponse {
        message: "passkey deleted",
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

impl From<PasskeyRecord> for PasskeyResponse {
    fn from(value: PasskeyRecord) -> Self {
        let _ = value.user_id;
        let _ = value.credential_id;
        let _ = value.credential;
        Self {
            id: value.id.to_string(),
            label: value.label,
            created_at: value.created_at,
            last_used_at: value.last_used_at,
        }
    }
}

impl PasskeyRecord {
    fn passkey(&self) -> Result<Passkey, AuthError> {
        serde_json::from_value(self.credential.clone())
            .map_err(|error| AuthError::Internal(error.to_string()))
    }
}

async fn find_user_by_username(
    pool: &PgPool,
    username: &str,
) -> Result<Option<UserRecord>, AuthError> {
    sqlx::query_as::<_, UserRecord>(
        "SELECT id, username, password_hash, ai_settings FROM auth_user WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))
}

async fn list_passkey_records_by_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<Vec<PasskeyRecord>, AuthError> {
    sqlx::query_as::<_, PasskeyRecord>(
        r#"
        SELECT id, user_id, label, credential_id, credential, created_at, last_used_at
        FROM auth_passkey
        WHERE user_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))
}

async fn count_users(pool: &PgPool) -> Result<i64, AuthError> {
    sqlx::query_scalar("SELECT COUNT(*) FROM auth_user")
        .fetch_one(pool)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))
}

async fn find_user_by_id(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<UserRecord, AuthError> {
    sqlx::query_as::<_, UserRecord>(
        "SELECT id, username, password_hash, ai_settings FROM auth_user WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&mut **tx)
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

async fn revoke_all_sessions_for_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<(), AuthError> {
    sqlx::query(
        "UPDATE auth_session SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
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

async fn log_auth_failure(
    pool: &PgPool,
    headers: &HeaderMap,
    event_type: &str,
    username: &str,
    user_id: Option<Uuid>,
) -> Result<(), AuthError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    log_auth_event(
        &mut tx,
        user_id,
        None,
        event_type,
        request_ip_address(headers).as_deref(),
        json!({ "username": username }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))
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
    let length = password.chars().count();
    if length < 12 {
        return Err(AuthError::BadRequest(
            "password must be at least 12 characters long".to_string(),
        ));
    }
    if length > 1024 {
        return Err(AuthError::BadRequest("password is too long".to_string()));
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

pub async fn admin_reset_password(
    pool: &PgPool,
    username: &str,
    new_password: &str,
) -> Result<(), AuthError> {
    let username = normalize_username(username)?;
    validate_password(new_password)?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    let user = sqlx::query_as::<_, UserRecord>(
        "SELECT id, username, password_hash, ai_settings FROM auth_user WHERE username = $1",
    )
    .bind(&username)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| AuthError::Internal(error.to_string()))?
    .ok_or_else(|| AuthError::BadRequest("user not found".to_string()))?;

    let password_hash = hash_password(new_password)?;
    sqlx::query("UPDATE auth_user SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(password_hash)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    revoke_all_sessions_for_user(&mut tx, user.id).await?;
    log_auth_event(
        &mut tx,
        Some(user.id),
        None,
        "password_reset_admin",
        None,
        json!({ "username": user.username }),
    )
    .await?;
    tx.commit()
        .await
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

async fn cleanup_expired_webauthn_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), AuthError> {
    sqlx::query("DELETE FROM auth_webauthn_registration WHERE expires_at <= NOW()")
        .execute(&mut **tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    sqlx::query("DELETE FROM auth_webauthn_authentication WHERE expires_at <= NOW()")
        .execute(&mut **tx)
        .await
        .map_err(|error| AuthError::Internal(error.to_string()))?;
    Ok(())
}

fn parse_uuid(input: &str, message: &str) -> Result<Uuid, AuthError> {
    Uuid::parse_str(input).map_err(|_| AuthError::BadRequest(message.to_string()))
}

fn sanitize_passkey_label(input: Option<String>) -> Result<String, AuthError> {
    let label = sanitize_optional_text(input, 80)
        .ok_or_else(|| AuthError::BadRequest("passkey label is required".to_string()))?;

    if label.chars().count() < 2 {
        return Err(AuthError::BadRequest(
            "passkey label must be at least 2 characters long".to_string(),
        ));
    }

    Ok(label)
}

fn credential_id_string(credential_id: &CredentialID) -> String {
    URL_SAFE_NO_PAD.encode(credential_id)
}

fn map_webauthn_error(error: WebauthnError) -> AuthError {
    AuthError::BadRequest(format!("passkey ceremony failed: {error}"))
}

fn request_context(headers: &HeaderMap, device_name: Option<String>) -> RequestContext {
    RequestContext {
        device_name: sanitize_optional_text(device_name, 120),
        ip_address: request_ip_address(headers),
        user_agent: sanitize_optional_text(
            headers
                .get(header::USER_AGENT)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned),
            512,
        ),
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
        .and_then(|value| sanitize_optional_text(Some(value), 128))
}

fn sanitize_optional_text(input: Option<String>, max_length: usize) -> Option<String> {
    input
        .map(|value| {
            value
                .trim()
                .chars()
                .filter(|character| !character.is_control())
                .take(max_length)
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
}

impl From<AuthEventRecord> for AuthEventResponse {
    fn from(value: AuthEventRecord) -> Self {
        Self {
            id: value.id.to_string(),
            user_id: value.user_id.map(|id| id.to_string()),
            session_id: value.session_id.map(|id| id.to_string()),
            event_type: value.event_type,
            ip_address: value.ip_address,
            metadata: value.metadata,
            created_at: value.created_at,
        }
    }
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
            webauthn_rp_id: "localhost".to_string(),
            webauthn_rp_origin: "http://localhost:5173".to_string(),
            webauthn_rp_name: "mony".to_string(),
        })
        .expect("auth state should initialize")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_cookie_header, clear_auth_cookie_headers, extract_cookie, hash_token, key_id,
        normalize_username, require_csrf, validate_password,
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

    #[test]
    fn usernames_are_normalized_to_trimmed_lowercase() {
        assert_eq!(
            normalize_username("  Owner.Admin  ").expect("username should normalize"),
            "owner.admin"
        );
    }

    #[test]
    fn invalid_usernames_are_rejected() {
        assert!(normalize_username("ab").is_err());
        assert!(normalize_username("owner admin").is_err());
    }

    #[test]
    fn password_validation_rejects_short_and_huge_values() {
        assert!(validate_password("short").is_err());
        assert!(validate_password(&"a".repeat(1025)).is_err());
        assert!(validate_password("correct horse battery staple").is_ok());
    }

    #[tokio::test]
    async fn middleware_rejects_missing_bearer_token() {
        let auth = crate::auth::test_support::auth_state();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://mony:mony@127.0.0.1:5432/mony")
            .expect("lazy pool should initialize");
        let state = crate::state::AppState {
            db: pool,
            auth,
            rate_limiter: crate::security::RateLimiter::new(),
        };
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
