use std::{env, num::ParseIntError};

use thiserror::Error;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
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

        Ok(Self { host, port })
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
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, ConfigError};

    #[test]
    fn defaults_are_applied_when_env_is_missing() {
        let config = AppConfig::from_lookup(|_| None).expect("config should use defaults");

        assert_eq!(
            config,
            AppConfig {
                host: "127.0.0.1".to_owned(),
                port: 3000,
            }
        );
    }

    #[test]
    fn invalid_port_is_rejected() {
        let error = AppConfig::from_lookup(|key| match key {
            "MONY_HOST" => Some("0.0.0.0".to_owned()),
            "MONY_PORT" => Some("not-a-port".to_owned()),
            _ => None,
        })
        .expect_err("invalid MONY_PORT should fail");

        assert!(matches!(error, ConfigError::InvalidPort { .. }));
    }
}
