use std::{env, error::Error};

use mony_backend::{
    app::build_router,
    auth::{admin_reset_password, AuthState},
    categorization::reapply_category_rules,
    config::AppConfig,
    db::connect_and_migrate,
    security::RateLimiter,
    state::AppState,
};
use tokio::{net::TcpListener, signal};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let _ = dotenvy::dotenv();
    init_tracing();

    let config = AppConfig::from_env()?;
    let pool = connect_and_migrate(&config.database).await?;
    let auth = AuthState::new(&config.auth)?;
    let args: Vec<String> = env::args().collect();

    if matches!(args.get(1).map(String::as_str), Some("recategorize")) {
        let summary = reapply_category_rules(&pool).await?;
        info!(
            scanned_transactions = summary.scanned_transactions,
            filled_uncategorized = summary.filled_uncategorized,
            repaired_legacy_salary = summary.repaired_legacy_salary,
            cleared_legacy_salary = summary.cleared_legacy_salary,
            refined_finance_transfer = summary.refined_finance_transfer,
            corrected_existing_categories = summary.corrected_existing_categories,
            "reapplied category rules"
        );
        return Ok(());
    }

    if matches!(args.get(1).map(String::as_str), Some("reset-password")) {
        let username = args
            .get(2)
            .ok_or("usage: cargo run -p mony-backend -- reset-password <username>")?;
        let new_password = rpassword::prompt_password("New password: ")?;
        admin_reset_password(&pool, username, &new_password).await?;
        info!(%username, "password reset completed");
        return Ok(());
    }

    let address = config.address();
    let listener = TcpListener::bind(&address).await?;
    let state = AppState {
        db: pool,
        auth,
        rate_limiter: RateLimiter::new(),
        gemini_api_key: config.gemini_api_key,
    };

    info!(%address, "starting backend");

    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("mony_backend=debug,tower_http=info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }

    info!("shutdown signal received");
}
