use std::{env, num::ParseIntError};

use thiserror::Error;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3000;
const DEFAULT_POSTGRES_HOST: &str = "127.0.0.1";
const DEFAULT_POSTGRES_PORT: u16 = 5432;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub database: DatabaseConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
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
            database: lookup("POSTGRES_DB").ok_or(ConfigError::MissingEnv {
                key: "POSTGRES_DB",
            })?,
            user: lookup("POSTGRES_USER").ok_or(ConfigError::MissingEnv {
                key: "POSTGRES_USER",
            })?,
            password: lookup("POSTGRES_PASSWORD").ok_or(ConfigError::MissingEnv {
                key: "POSTGRES_PASSWORD",
            })?,
        };

        Ok(Self {
            host,
            port,
            database,
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
    #[error("missing required environment variable {key}")]
    MissingEnv { key: &'static str },
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, ConfigError, DatabaseConfig};

    #[test]
    fn defaults_are_applied_when_env_is_missing() {
        let config = AppConfig::from_lookup(|key| match key {
            "POSTGRES_DB" => Some("mony".to_owned()),
            "POSTGRES_USER" => Some("mony_app".to_owned()),
            "POSTGRES_PASSWORD" => Some("test-password".to_owned()),
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
            _ => None,
        })
        .expect_err("invalid MONY_PORT should fail");

        assert!(matches!(error, ConfigError::InvalidPort { .. }));
    }

    #[test]
    fn postgres_settings_are_required() {
        let error = AppConfig::from_lookup(|_| None).expect_err("database config should be required");

        assert!(matches!(
            error,
            ConfigError::MissingEnv {
                key: "POSTGRES_DB"
            }
        ));
    }
}
