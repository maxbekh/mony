ENV_FILE ?= .env

.PHONY: check compose-config up-db down

check: compose-config
	test -f README.md
	test -f SECURITY.md
	test -f docs/adr/0001-initial-tech-stack.md
	test -f docs/adr/0002-unified-financial-schema.md
	test -f docs/adr/0003-financial-invariants-and-idempotent-imports.md

compose-config:
	test -f $(ENV_FILE)
	docker compose --env-file $(ENV_FILE) config >/dev/null

up-db:
	docker compose --env-file $(ENV_FILE) up -d db

down:
	docker compose --env-file $(ENV_FILE) down
