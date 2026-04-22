# Changelog

All notable changes to DataLens are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0-beta] — 2026-04-22

First public-beta candidate. Four hardening waves bring DataLens from initial proof-of-concept to launch-ready: contract drift cleanup, deployment fixes, test surface expansion, security hardening, accessibility work, and launch-artifact preparation.

### Added

- **DuckDB-WASM in-browser analytics** — analytical SQL over millions of rows with zero backend round-trips. Data never leaves the browser for queries.
- **Local AI assistant** — natural-language → SQL via your local Ollama instance. Rule-based fallback for simple prompts when Ollama isn't running. Nothing leaves the machine.
- **40+ chart types** — line, bar, pivot, sankey, heatmap, treemap, boxplot, scatter, area, gauge, funnel, radar, and more via ECharts.
- **Dashboard builder** — compose multi-chart dashboards with saved layouts, drag-to-resize tiles, and per-tile query binding.
- **ML workflows** — regression, clustering, classification, PCA, decision trees backed by scikit-learn. Results surface as both tables and charts.
- **Data pipelines** — 11 transform types (filter, select, aggregate, join, pivot, sort, dedupe, rename, derived-column, cast, window) with preview-at-each-stage and reusable pipeline definitions.
- **Sample datasets built-in** — 4,600+ rows of realistic ecommerce, payments, and web-analytics data, pre-loaded for first-run exploration.
- **Persistence tier** — bookmarks, pipelines, and query history persist to Postgres via Alembic migration `c6dc7592ba0a`. Zustand stores hydrate on login and write-through on user action; fall back to `localStorage` when unauthenticated or backend unreachable.
- **Error boundaries per route** — every workspace route (`dashboard`, `data-ops`, `explore`, `pivot`, `profile`, `reports`, `settings`, `sql`, `transforms`) ships a sibling `error.tsx` with scoped fallback card and "Try again" button. Failures isolate to one panel instead of taking down the whole route.
- **Sync-safety surface** — stores tag records with a `synced` flag when a backend write fails, emit a toast via `sync-feedback`, and expose `syncPending()` for manual retry. Bookmarks UI shows a retry indicator for unsynced rows and a header-level "Sync now" button.
- **Reverse-proxy deploy guide** — `docs/deploy.md` ships a Caddy example for public-facing deployments where the browser talks to a single HTTPS origin.
- **Docker Compose quick start** — one-command self-host with `docker compose up`. Dockerfile bakes browser-reachable URLs as build ARGs.
- **Rate limiting** on persistence endpoints: 60/min for list + history writes, 30/min for bookmarks/pipelines create/update/delete.
- **Contract drift regression tests** — end-to-end FE↔BE shape tests for AI / analytics / types / WebSocket / persistence (56 new tests).
- **k6 load-test baseline** for `/api/query` — reproducible perf floor tracked in CI-adjacent tooling.
- **Hypothesis fuzz tests** for CSV and XLSX parsers (OWASP XSS payload sweep + malformed-input corpora).
- **Accessibility coverage** — jest-axe smoke tests for 8 UI primitives, extended across forms, shell, charts, and dialogs. WCAG 2.1 AA gaps surfaced in CI.
- **Self-hosted GitHub Actions runner guide** (`docs/ci/self-hosted-runner.md`) — reduces CI minutes burn during hardening waves.
- **Custom launch pages** — polished 404, error boundary, and critical-error fallback with brand-consistent copy.
- **SEO / OG surface** — complete Open Graph + Twitter Card metadata, dynamic sitemap, `robots.txt`, runtime-generated OG image.

### Changed

- **API route prefix unified** — frontend now uses `/api` (matching backend mount), removing the `/api/v1` double-path that silently 404'd on several routes.
- **FE↔BE field naming aligned** across AI, ML, and analytics endpoints (snake_case at the wire, camelCase on the client, explicit mapping layer).
- **FastAPI startup/shutdown** migrated from deprecated `@app.on_event` handlers to `@asynccontextmanager lifespan`. `Base.metadata.create_all()` no longer called at startup — Alembic is the sole source of truth. Migration drift surfaced via the health endpoint (dev: warn, strict env: fail-fast).
- **In-memory SQLite test support** — uses `StaticPool` so the single connection retains schema across requests. Conftest runs `alembic upgrade head` as a session-scoped autouse fixture.
- **Type hints** — persistence API `list_*` handlers annotate `list[BookmarkRead | PipelineRead | QueryHistoryRead]` to match their FastAPI `response_model`.
- **CLAUDE.md** — replaced 1-line stub with full agent orientation (architecture, import conventions, test env, contract discipline, ratchet coverage floors).
- **README** — added CI and Release badges, What's new section, comparison table against Metabase/Tableau/cloud BI, troubleshooting section.

### Fixed

- **AI `/api/ai/generate-query`** — frontend now sends schema + sample rows; backend routes through the NL→SQL service, eliminating the generic `COUNT(*) / SELECT *` fallback.
- **A/B test endpoint** — frontend sends the tabular `{ data, group_column, metric_column, variant_a, variant_b }` payload; UI reads the real summary fields instead of treating `effect_size` as lift.
- **Forecast endpoint** — request fields renamed to `date_col` / `value_col`; response aligned to `{ method, history_points, forecast_points, metrics }`; silent local fallback now labeled and only triggers on backend failure.
- **WebSocket streaming** — handshake URL carries both `token` and `dataset_id`; hooks plumb the dataset id through the streaming viewer and data-ops page.
- **Churn model** — backend rejects requests where `target_column ∈ feature_columns`; frontend derives a 30-day-inactivity `churned` label and drops `recency_days` from features so the GBM learns engagement patterns instead of regressing recency on itself.
- **Docker quick start** — `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` point at `localhost:8000` (browser-reachable) instead of Docker-internal `backend:8000`. README requires `cp .env.example .env` before `docker compose up`, documents Python 3.12 / Node 22 / Docker 24 floors.
- **Register form** — Pydantic `detail[]` arrays parsed into per-field errors. Password validation failures render inline with `aria-invalid` + `aria-describedby`. Database write errors logged and returned as `409` / `500` with user-friendly messaging.
- **Auth** — registration returns a token on success; the `/api/v1` double-path that caused intermittent 404s is gone.
- **Persistence upsert** split into POST-create + PATCH-update so the REST surface follows HTTP semantics and stops conflating two operations (Wave 4).
- **Accessibility** — explicit `htmlFor` + `id` pairs added across settings forms; `label-has-associated-control` restored to eslint error.
- **CSP tightened** — stricter `default-src`, `script-src`, `style-src` directives; JWT configuration fails fast on insecure defaults in non-development environments.
- **Error surfacing** — Pydantic 422 validation arrays and DB exceptions now rendered cleanly instead of dumping raw Python tracebacks.

### Security

- **CSP hardening** (Wave 4) — stricter directives across `default-src` / `script-src` / `style-src`; `wasm-unsafe-eval` scoped narrowly for DuckDB-WASM.
- **JWT fail-fast** — backend refuses to boot with an insecure `JWT_SECRET` (`change-me`, etc.) outside `development` environments.
- **CodeQL workflow gated** — security job wired to fail the merge queue once GitHub Code Scanning is toggled on in repo settings.
- **Next.js + xlsx CVE patches** applied (Wave 2).
- **XSS payload sweep** — OWASP-aligned payloads exercised against CSV/XLSX parsers and render paths; 4 component fixes landed, 4 tests remain `it.skip` pending real component repairs.
- **Middleware** migrated to the Next.js 16-recommended pattern; removes a class of middleware-related CVE exposure.
- **pip-audit + npm audit + Dependabot** integrated; 4 Dependabot PRs currently open (patch/minor bumps for next, posthog-js, posthog-node, eslint-config-next) — ready to land after main CI re-enables.

### Known gaps (tracked as follow-ups)

- 4 XSS regression tests (`src/__tests__/security/xss.test.tsx`) remain `it.skip` pending component-level fixes.
- GitHub code scanning (`continue-on-error` on the `security` job) does not gate merges until Settings → Security enables the feature.
- `Base.metadata.create_all` compatibility fallback intentionally not provided; tests spinning up their own `TestClient` rely on the session-autouse migration fixture.
- 4 Dependabot PRs (patch/minor bumps) open and ready to land after main CI re-enables post-billing-fix.

---

Links between waves and commits:

- Wave 1 (foundation) — initial app, DuckDB-WASM wiring, chart builder, dashboard, ML surface.
- Wave 2 (bug hunt) — contract drift discovery, fuzz + a11y + k6 coverage, security CVE patching.
- Wave 3 (contract + deploy) — FE↔BE alignment, Docker fixes, persistence tier, error surfacing.
- Wave 4 (security + a11y polish) — CSP, JWT fail-fast, CodeQL gating, a11y label coverage, error boundaries per route.
