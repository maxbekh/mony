use std::{env, num::ParseIntError};

use thiserror::Error;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3000;
const DEFAULT_POSTGRES_HOST: &str = "127.0.0.1";
const DEFAULT_POSTGRES_PORT: u16 = 5432;
const DEFAULT_AUTH_ISSUER: &str = "mony";
const DEFAULT_AUTH_AUDIENCE: &str = "mony-api";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS: i64 = 600;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS: i64 = 30;
const DEFAULT_SECURE_COOKIES: bool = false;
const DEFAULT_WEBAUTHN_RP_NAME: &str = "mony";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    pub gemini_api_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthConfig {
    pub issuer: String,
    pub audience: String,
    pub jwt_private_key_path: String,
    pub jwt_public_key_path: String,
    pub access_token_ttl_seconds: i64,
    pub refresh_token_ttl_days: i64,
    pub secure_cookies: bool,
    pub webauthn_rp_id: String,
    pub webauthn_rp_origin: String,
    pub webauthn_rp_name: String,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| env::var(key).ok())
    }

    pub fn address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    fn from_lookup<F>(mut lookup: F) -> Result<Self, ConfigError>
    where
        F: FnMut(&str) -> Option<String>,
    {
        let host = lookup("MONY_HOST").unwrap_or_else(|| DEFAULT_HOST.to_owned());
        let port = match lookup("MONY_PORT") {
            Some(value) => value
                .parse()
                .map_err(|source| ConfigError::InvalidPort { value, source })?,
            None => DEFAULT_PORT,
        };

        let database = DatabaseConfig {
            host: lookup("POSTGRES_HOST").unwrap_or_else(|| DEFAULT_POSTGRES_HOST.to_owned()),
            port: match lookup("POSTGRES_PORT") {
                Some(value) => value
                    .parse()
                    .map_err(|source| ConfigError::InvalidPostgresPort { value, source })?,
                None => DEFAULT_POSTGRES_PORT,
            },
            database: lookup("POSTGRES_DB")
                .ok_or(ConfigError::MissingEnv { key: "POSTGRES_DB" })?,
            user: lookup("POSTGRES_USER").ok_or(ConfigError::MissingEnv {
                key: "POSTGRES_USER",
            })?,
            password: lookup("POSTGRES_PASSWORD").ok_or(ConfigError::MissingEnv {
                key: "POSTGRES_PASSWORD",
            })?,
        };

        let auth = AuthConfig {
            issuer: lookup("MONY_AUTH_ISSUER").unwrap_or_else(|| DEFAULT_AUTH_ISSUER.to_owned()),
            audience: lookup("MONY_AUTH_AUDIENCE")
                .unwrap_or_else(|| DEFAULT_AUTH_AUDIENCE.to_owned()),
            jwt_private_key_path: lookup("MONY_AUTH_JWT_PRIVATE_KEY_PATH").ok_or(
                ConfigError::MissingEnv {
                    key: "MONY_AUTH_JWT_PRIVATE_KEY_PATH",
                },
            )?,
            jwt_public_key_path: lookup("MONY_AUTH_JWT_PUBLIC_KEY_PATH").ok_or(
                ConfigError::MissingEnv {
                    key: "MONY_AUTH_JWT_PUBLIC_KEY_PATH",
                },
            )?,
            access_token_ttl_seconds: parse_i64_with_default(
                lookup("MONY_AUTH_ACCESS_TOKEN_TTL_SECONDS"),
                DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
                |value, source| ConfigError::InvalidAccessTokenTtl { value, source },
            )?,
            refresh_token_ttl_days: parse_i64_with_default(
                lookup("MONY_AUTH_REFRESH_TOKEN_TTL_DAYS"),
                DEFAULT_REFRESH_TOKEN_TTL_DAYS,
                |value, source| ConfigError::InvalidRefreshTokenTtl { value, source },
            )?,
            secure_cookies: parse_bool_with_default(
                lookup("MONY_AUTH_SECURE_COOKIES"),
                DEFAULT_SECURE_COOKIES,
            )?,
            webauthn_rp_id: lookup("MONY_AUTH_WEBAUTHN_RP_ID").ok_or(ConfigError::MissingEnv {
                key: "MONY_AUTH_WEBAUTHN_RP_ID",
            })?,
            webauthn_rp_origin: lookup("MONY_AUTH_WEBAUTHN_RP_ORIGIN").ok_or(
                ConfigError::MissingEnv {
                    key: "MONY_AUTH_WEBAUTHN_RP_ORIGIN",
                },
            )?,
            webauthn_rp_name: lookup("MONY_AUTH_WEBAUTHN_RP_NAME")
                .unwrap_or_else(|| DEFAULT_WEBAUTHN_RP_NAME.to_owned()),
        };

        let gemini_api_key = lookup("GEMINI_API_KEY");

        Ok(Self {
            host,
            port,
            database,
            auth,
            gemini_api_key,
        })
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("invalid MONY_PORT value '{value}': {source}")]
    InvalidPort {
        value: String,
        #[source]
        source: ParseIntError,
    },
    #[error("invalid POSTGRES_PORT value '{value}': {source}")]
    InvalidPostgresPort {
        value: String,
        #[source]
        source: ParseIntError,
    },
    #[error("invalid MONY_AUTH_ACCESS_TOKEN_TTL_SECONDS value '{value}': {source}")]
    InvalidAccessTokenTtl {
        value: String,
        #[source]
        source: ParseIntError,
    },
    #[error("invalid MONY_AUTH_REFRESH_TOKEN_TTL_DAYS value '{value}': {source}")]
    InvalidRefreshTokenTtl {
        value: String,
        #[source]
        source: ParseIntError,
    },
    #[error("invalid MONY_AUTH_SECURE_COOKIES value '{0}': expected true or false")]
    InvalidBoolean(String),
    #[error("missing required environment variable {key}")]
    MissingEnv { key: &'static str },
}

fn parse_i64_with_default<F>(
    value: Option<String>,
    default: i64,
    map_error: F,
) -> Result<i64, ConfigError>
where
    F: FnOnce(String, ParseIntError) -> ConfigError + Copy,
{
    match value {
        Some(value) => value.parse().map_err(|source| map_error(value, source)),
        None => Ok(default),
    }
}

fn parse_bool_with_default(value: Option<String>, default: bool) -> Result<bool, ConfigError> {
    match value {
        Some(value) => match value.as_str() {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(ConfigError::InvalidBoolean(value)),
        },
        None => Ok(default),
    }
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, AuthConfig, ConfigError, DatabaseConfig};

    #[test]
    fn defaults_are_applied_when_env_is_missing() {
        let config = AppConfig::from_lookup(|key| match key {
            "POSTGRES_DB" => Some("mony".to_owned()),
            "POSTGRES_USER" => Some("mony_app".to_owned()),
            "POSTGRES_PASSWORD" => Some("test-password".to_owned()),
            "MONY_AUTH_JWT_PRIVATE_KEY_PATH" => Some("/tmp/private.pem".to_owned()),
            "MONY_AUTH_JWT_PUBLIC_KEY_PATH" => Some("/tmp/public.pem".to_owned()),
            "MONY_AUTH_WEBAUTHN_RP_ID" => Some("localhost".to_owned()),
            "MONY_AUTH_WEBAUTHN_RP_ORIGIN" => Some("http://localhost:5173".to_owned()),
            _ => None,
        })
        .expect("config should use defaults");

        assert_eq!(
            config,
            AppConfig {
                host: "127.0.0.1".to_owned(),
                port: 3000,
                database: DatabaseConfig {
                    host: "127.0.0.1".to_owned(),
                    port: 5432,
                    database: "mony".to_owned(),
                    user: "mony_app".to_owned(),
                    password: "test-password".to_owned(),
                },
                auth: AuthConfig {
                    issuer: "mony".to_owned(),
                    audience: "mony-api".to_owned(),
                    jwt_private_key_path: "/tmp/private.pem".to_owned(),
                    jwt_public_key_path: "/tmp/public.pem".to_owned(),
                    access_token_ttl_seconds: 600,
                    refresh_token_ttl_days: 30,
                    secure_cookies: false,
                    webauthn_rp_id: "localhost".to_owned(),
                    webauthn_rp_origin: "http://localhost:5173".to_owned(),
                    webauthn_rp_name: "mony".to_owned(),
                },
                gemini_api_key: None,
            }
        );
    }

    #[test]
    fn invalid_port_is_rejected() {
        let error = AppConfig::from_lookup(|key| match key {
            "MONY_HOST" => Some("0.0.0.0".to_owned()),
            "MONY_PORT" => Some("not-a-port".to_owned()),
            "POSTGRES_DB" => Some("mony".to_owned()),
            "POSTGRES_USER" => Some("mony_app".to_owned()),
            "POSTGRES_PASSWORD" => Some("test-password".to_owned()),
            "MONY_AUTH_JWT_PRIVATE_KEY_PATH" => Some("/tmp/private.pem".to_owned()),
            "MONY_AUTH_JWT_PUBLIC_KEY_PATH" => Some("/tmp/public.pem".to_owned()),
            "MONY_AUTH_WEBAUTHN_RP_ID" => Some("localhost".to_owned()),
            "MONY_AUTH_WEBAUTHN_RP_ORIGIN" => Some("http://localhost:5173".to_owned()),
            _ => None,
        })
        .expect_err("invalid MONY_PORT should fail");

        assert!(matches!(error, ConfigError::InvalidPort { .. }));
    }

    #[test]
    fn postgres_settings_are_required() {
        let error =
            AppConfig::from_lookup(|_| None).expect_err("database config should be required");

        assert!(matches!(
            error,
            ConfigError::MissingEnv { key: "POSTGRES_DB" }
        ));
    }

    #[test]
    fn auth_key_paths_are_required() {
        let error = AppConfig::from_lookup(|key| match key {
            "POSTGRES_DB" => Some("mony".to_owned()),
            "POSTGRES_USER" => Some("mony_app".to_owned()),
            "POSTGRES_PASSWORD" => Some("test-password".to_owned()),
            _ => None,
        })
        .expect_err("auth key paths should be required");

        assert!(matches!(
            error,
            ConfigError::MissingEnv {
                key: "MONY_AUTH_JWT_PRIVATE_KEY_PATH"
            }
        ));
    }
}
