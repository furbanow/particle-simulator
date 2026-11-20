.DEFAULT_GOAL := help
.PHONY: help install dev build check-dist preview typecheck test check clean distclean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

node_modules: package.json
	npm install
	@touch node_modules

install: node_modules ## Install npm dependencies

dev: node_modules ## Start the development server (http://localhost:5173)
	npm run dev

build: node_modules ## Type-check then build the app into dist/ (and check the dev-only lab is not in it)
	npm run build
	@$(MAKE) --no-print-directory check-dist

check-dist: ## Fail if dist/ holds anything of the dev-only lab (lab.html, src/lab)
	@test -d dist || { echo 'check-dist: no dist/, run make build' >&2; exit 1; }
	@if find dist \( -name 'lab.html' -o -path '*/lab/*' \) | grep -q . || grep -rIlq -e '__labResults' dist; then \
	    echo 'check-dist: dist/ contains the dev-only lab' >&2; exit 1; \
	fi
	@echo 'check-dist: dist/ is free of the lab'

preview: build ## Serve the built version (dist/)
	npm run preview

typecheck: node_modules ## Type-check TypeScript
	npm run typecheck

test: node_modules ## Run the unit tests (Vitest)
	npm test

check: typecheck test ## Types + tests

clean: ## Remove dist/
	rm -rf dist

distclean: clean ## Remove dist/ and node_modules/
	rm -rf node_modules
