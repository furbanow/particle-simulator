.DEFAULT_GOAL := help
.PHONY: help install dev build preview typecheck test check clean distclean

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

node_modules: package.json
	npm install
	@touch node_modules

install: node_modules ## Installe les dépendances npm

dev: node_modules ## Lance le serveur de développement (http://localhost:5173)
	npm run dev

build: node_modules ## Vérifie les types puis construit l'application dans dist/
	npm run build

preview: build ## Sert la version construite (dist/)
	npm run preview

typecheck: node_modules ## Vérifie les types TypeScript
	npm run typecheck

test: node_modules ## Lance les tests unitaires (Vitest)
	npm test

check: typecheck test ## Types + tests

clean: ## Supprime dist/
	rm -rf dist

distclean: clean ## Supprime dist/ et node_modules/
	rm -rf node_modules
