FROM rust:1.88-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml backend/Cargo.toml
COPY backend/src backend/src
COPY backend/migrations backend/migrations

RUN cargo build --release --locked -p mony-backend

FROM debian:bookworm-slim AS runtime
WORKDIR /app

COPY --from=builder /app/target/release/mony-backend /usr/local/bin/mony-backend

EXPOSE 3000

CMD ["mony-backend"]
