# Changelog

All notable changes to DataLens are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0-beta] — 2026-04-18

First public-beta candidate. Closes the contract-drift and deployment gaps identified in the Wave 2 internal audit; raises the audit score from 4.5/10 to 7.5/10.

### Fixed

- **AI `/api/ai/generate-query`**: frontend now sends schema + sample rows; backend routes them through the NL→SQL service, eliminating the generic `COUNT(*) / SELECT *` fallback that made backend mode worse than local compute.
- **A/B test endpoint**: frontend sends the tabular `{ data, group_column, metric_column, variant_a, variant_b }` payload that the backend schema expects; UI reads the real summary fields instead of treating `effect_size` as lift.
- **Forecast endpoint**: request fields renamed to `date_col` / `value_col`; response shape aligned to `{ method, history_points, forecast_points, metrics }`; the silent local fallback is now labeled and only triggers on backend failure.
- **WebSocket streaming**: handshake URL carries both `token` and `dataset_id`; hooks plumb the dataset id through; the streaming viewer and data-ops page now pass the correct value at connect time.
- **Churn model**: backend rejects requests where `target_column ∈ feature_columns`; frontend derives a 30-day-inactivity `churned` label and drops `recency_days` from the feature list so the GBM learns engagement/activity patterns instead of regressing recency on itself.
- **Docker quick start**: `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` now point at `localhost:8000` (browser-reachable) instead of the Docker-internal `backend:8000`. Dockerfile bakes public URLs as build ARGs. README now requires `cp .env.example .env` before `docker compose up`, and documents the Python 3.12 / Node 22 / Docker 24 floors.
- **Register form**: FastAPI / Pydantic `detail[]` arrays are now parsed into per-field errors. Password validation failures render inline with `aria-invalid` + `aria-describedby`. Non-password failures route to the toast system. Database write errors are logged and returned as `409` / `500` with user-friendly messaging.

### Added

- **Persistence tier**: bookmarks, pipelines, and query history now persist to Postgres. Alembic migration `c6dc7592ba0a` creates user-scoped tables with CASCADE delete. Zustand stores hydrate on login and write-through on user action; they fall back to `localStorage` when unauthenticated or when the backend is unreachable.
- **Error boundaries**: every workspace route (`dashboard`, `data-ops`, `explore`, `pivot`, `profile`, `reports`, `settings`, `sql`, `transforms`) now ships a sibling `error.tsx` that renders a scoped fallback card with a "Try again" button, isolating failures to one panel instead of taking down the whole route.
- **Sync-safety surface**: stores tag records with an optional `synced` flag when a backend write fails, emit a toast via a new `sync-feedback` helper, and expose `syncPending()` for a manual retry. The bookmarks UI shows a 🔄 indicator for unsynced rows and a header-level "Sync now" button.
- **Reverse-proxy deploy guide**: `docs/deploy.md` ships a Caddy example for public-facing deployments where the browser talks to a single HTTPS origin.
- **Contract drift regression tests**: end-to-end frontend ↔ backend shape tests for AI / analytics / types / WebSocket / persistence (56 new tests).
- **Rate limiting** on the new persistence endpoints: 60/min for list + history writes, 30/min for create/update/delete on bookmarks and pipelines.

### Changed

- **FastAPI startup/shutdown** migrated from deprecated `@app.on_event` handlers to `@asynccontextmanager lifespan`. `Base.metadata.create_all()` is no longer called at startup — Alembic is the sole source of truth. Migration drift is surfaced via the health endpoint (dev: warn, strict env: fail-fast).
- **In-memory SQLite test support**: uses `StaticPool` so the single connection retains schema across requests. Conftest runs `alembic upgrade head` as a session-scoped autouse fixture and re-migrates on async-client teardown.
- **CLAUDE.md**: replaced the 1-line stub with a full agent orientation — architecture, import conventions, test env, contract discipline, ratchet coverage floors, and hard rules.
- **Type hints**: persistence API `list_*` handlers annotate `list[BookmarkRead | PipelineRead | QueryHistoryRead]` to match their FastAPI `response_model` rather than the ORM class.

### Deprecated

- Nothing removed; `on_event` handlers replaced internally. No public API change.

### Known gaps (tracked as follow-ups)

- 4 XSS regression tests (`src/__tests__/security/xss.test.tsx`) remain `it.skip` — real component fixes are needed. Tracked under the `wave4/xss-unskip` agent task.
- GitHub code scanning (`continue-on-error` on the `security` job) still does not gate merges because the repo has the feature disabled. Toggle via Settings → Security to enable.
- `Base.metadata.create_all` compatibility fallback is not provided; tests that spin up their own `TestClient` now rely on a session-autouse migration fixture in conftest.
- 4 Dependabot PRs are open (next, posthog-js, posthog-node, eslint-config-next). Patch/minor bumps, ready to land after main CI is re-enabled.
