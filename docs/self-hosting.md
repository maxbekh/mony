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
3. Generate a local JWT signing keypair:

```bash
mkdir -p .local/keys
openssl genrsa -out .local/keys/mony-jwt-private.pem 2048
openssl rsa -in .local/keys/mony-jwt-private.pem -pubout -out .local/keys/mony-jwt-public.pem
```

4. Review the remaining values before first boot.

Available environment variables:

- `MONY_HOST`
- `MONY_PORT`
- `MONY_AUTH_ISSUER`
- `MONY_AUTH_AUDIENCE`
- `MONY_AUTH_JWT_PRIVATE_KEY_PATH`
- `MONY_AUTH_JWT_PUBLIC_KEY_PATH`
- `MONY_AUTH_ACCESS_TOKEN_TTL_SECONDS`
- `MONY_AUTH_REFRESH_TOKEN_TTL_DAYS`
- `MONY_AUTH_SECURE_COOKIES`
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

Authentication notes:

- `.env` should use host paths such as `.local/keys/mony-jwt-private.pem` and `.local/keys/mony-jwt-public.pem`.
- The default compose setup mounts `./.local/keys` into the backend container at `/run/secrets`.
- Docker Compose overrides the backend JWT key paths internally so the same `.env` also works with `make run-backend` on the host.
- The backend signs short-lived JWT access tokens with the private key and publishes the public key through `/.well-known/jwks.json`.
- The first account is created through the one-time bootstrap flow exposed at `POST /v1/auth/bootstrap` while no account exists. Public registration is intentionally disabled after that.
- Signed-in users can change their password from the web `Settings` page.
- The web `Settings` page also shows recent security activity recorded by the backend.
- If recovery is needed and you have server access, use `cargo run -p mony-backend -- reset-password <username>` to set a new password and revoke existing sessions.
- For production, terminate TLS in front of the app and set `MONY_AUTH_SECURE_COOKIES=true`.

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
