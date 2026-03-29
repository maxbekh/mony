ENV_FILE ?= .env

.PHONY: check foundation-check compose-config backend-check frontend-check frontend-build frontend-lint up-db down run-backend

check: foundation-check backend-check frontend-check

foundation-check: compose-config
	test -f README.md
	test -f CONTRIBUTING.md
	test -f SECURITY.md
	test -f docs/adr/0001-initial-tech-stack.md
	test -f docs/adr/0002-unified-financial-schema.md
	test -f docs/adr/0003-financial-invariants-and-idempotent-imports.md

compose-config:
	test -f $(ENV_FILE)
	docker compose --env-file $(ENV_FILE) config >/dev/null

backend-check:
	cargo fmt --all --check
	cargo clippy --workspace --all-targets --all-features -- -D warnings
	cargo test --workspace

frontend-check:
	npm run lint --prefix frontend
	npm run build --prefix frontend

frontend-lint:
	npm run lint --prefix frontend

frontend-build:
	npm run build --prefix frontend

up-db:
	docker compose --env-file $(ENV_FILE) up -d db

down:
	docker compose --env-file $(ENV_FILE) down

run-backend:
	cargo run -p mony-backend
