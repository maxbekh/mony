use std::{env, error::Error};

use mony_backend::{
    app::build_router, categorization::reapply_category_rules, config::AppConfig,
    db::connect_and_migrate, state::AppState,
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

    if matches!(env::args().nth(1).as_deref(), Some("recategorize")) {
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

    let address = config.address();
    let listener = TcpListener::bind(&address).await?;
    let state = AppState { db: pool };

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
