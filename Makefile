# Al-Majeed ERP — common developer tasks.
# `make help` lists everything.

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install all workspace dependencies
	npm ci || npm install

.PHONY: up
up: ## Start Postgres (pgvector) and supporting services
	docker compose up -d db
	@echo "waiting for postgres..."
	@until docker compose exec -T db pg_isready -U erp >/dev/null 2>&1; do sleep 1; done
	@echo "postgres ready on :5432"

.PHONY: down
down: ## Stop all services
	docker compose down

.PHONY: reset-db
reset-db: ## Drop and recreate the database volume (DESTRUCTIVE)
	docker compose down -v
	$(MAKE) up
	$(MAKE) migrate
	$(MAKE) seed

.PHONY: migrate
migrate: ## Apply database migrations
	npm run db:migrate

.PHONY: generate
generate: ## Generate a migration from schema changes
	npm run db:generate

.PHONY: seed
seed: ## Load demo data
	npm run db:seed

.PHONY: dev
dev: ## Run API + web in watch mode
	npm run dev

.PHONY: test
test: ## Run the full test suite
	npm run test

.PHONY: verify
verify: ## format:check + lint + typecheck + test (what CI runs)
	npm run verify

.PHONY: build
build: ## Build every workspace
	npm run build

.PHONY: docker-build
docker-build: ## Build production container images
	docker build -f infra/docker/api.Dockerfile -t almajeed/erp-api:local .
	docker build -f infra/docker/web.Dockerfile -t almajeed/erp-web:local .
