# Tests

- `tests/e2e/agent-browser/`: repository-level browser smoke script and screenshot baseline for quick regressions against a running CodeRemote instance.
- `apps/web/e2e/`: Playwright coverage for Web UI interactions and page behavior.
- `apps/server/src/__tests__/`: backend unit and integration tests.

Prefer adding new tests to the nearest responsibility boundary instead of dropping scripts or screenshots at the repository root.
