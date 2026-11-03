.PHONY: help tui test node-test lint check format build bundle-check ci

help:
	@echo "Available targets:"
	@echo "  make tui     - Run the Textual TUI"
	@echo "  make test    - Run Python regression tests"
	@echo "  make node-test - Run offline Node regression tests"
	@echo "  make lint    - Run frontend lint"
	@echo "  make check   - Run frontend format check"
	@echo "  make format  - Format frontend files"
	@echo "  make build   - Build frontend assets"
	@echo "  make ci      - Run non-mutating tests, lint, check, build and bundle guard"

tui:
	uv run run_page

test:
	uv run --locked python -m pytest -q

node-test:
	node --test scripts/*.test.mjs

lint:
	pnpm run lint

check:
	pnpm run check

format:
	pnpm run format

build:
	pnpm run build

bundle-check:
	node scripts/performance/check-bundles.mjs

ci: test node-test lint check build bundle-check
