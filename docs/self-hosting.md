# Self-Hosting with Docker Compose

This repository includes a production-oriented `docker-compose.yml` for running:

- PostgreSQL
- the Rust backend
- the React frontend served by Nginx

The frontend container reverse-proxies `/health`, `/ready`, and `/v1/*` to the backend, so the browser only needs to talk to a single public origin.

## Prerequisites

- Docker Engine with Compose support
- a local `.env` file based on `.env.example`

## Configuration

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD` with a long random password.
3. Review the remaining values before first boot.

Available environment variables:

- `MONY_HOST`
- `MONY_PORT`
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

When running through Docker Compose, the backend service overrides the host and database address internally so it binds on `0.0.0.0` and connects to the `db` service.

## Start the stack

```bash
docker compose --env-file .env up --build -d
```

The exposed services are:

- frontend: `http://localhost/`
- backend health: `http://localhost/health`
- backend readiness: `http://localhost/ready`
- backend API: `http://localhost/v1/...`

The database is not published publicly by default.

## Stop the stack

```bash
docker compose --env-file .env down
```

To also remove the PostgreSQL volume:

```bash
docker compose --env-file .env down -v
```

## Updating

After pulling new changes:

```bash
docker compose --env-file .env up --build -d
```

## Notes

- PostgreSQL data is stored in the named volume `postgres_data`.
- The backend applies migrations on startup.
- The frontend production image serves the built assets from Nginx and forwards API traffic to the backend container.
- If `docker compose build` fails with an AppArmor or container runtime error, that is typically a host Docker environment issue rather than an application-level configuration error.
