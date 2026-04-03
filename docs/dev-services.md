# Detached Development Services

This repository includes `systemd` templates for a detached local development stack:

- PostgreSQL via Docker Compose
- the Rust backend via `cargo run -p mony-backend`
- the React frontend via `npm run dev`

This is intended for remote workflows where you want to connect once from a phone or a lightweight terminal, use Codex, and restart the app stack without holding multiple interactive shells open.

## Install

```bash
chmod +x scripts/install-dev-services.sh scripts/mony-services
./scripts/mony-services install
./scripts/mony-services start
```

The installer renders the templates from `dev/systemd/` into `/etc/systemd/system`, reloads the system daemon, and enables the units.

## Control

```bash
./scripts/mony-services status
./scripts/mony-services restart backend
./scripts/mony-services restart frontend
./scripts/mony-services restart all
./scripts/mony-services logs backend
./scripts/mony-services stop
```

## Addresses

- frontend dev server: `http://<host>:5173`
- backend API: proxied through Vite from `/api` to `http://127.0.0.1:3000`
- backend health: `http://<host>:3000/health`

Because these are system services, they continue running after logout once installed and started.
