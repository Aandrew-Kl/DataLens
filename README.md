<div align="center">

# DataLens

### Privacy-first AI data analytics that runs in your browser.

[![CI](https://github.com/Aandrew-Kl/DataLens/actions/workflows/ci.yml/badge.svg)](https://github.com/Aandrew-Kl/DataLens/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Aandrew-Kl/DataLens?include_prereleases)](https://github.com/Aandrew-Kl/DataLens/releases)
[![Version](https://img.shields.io/badge/version-0.9.0--beta-blueviolet.svg)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1%2C828_passing-brightgreen.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](#)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](#)

**[Live Demo](<!-- LIVE_URL -->) · [Docs](./docs-site) · [Architecture](./docs-site/content/architecture) · [Changelog](./CHANGELOG.md) · [Report an Issue](https://github.com/Aandrew-Kl/DataLens/issues)**

</div>

---

## What's new in 0.9.0-beta

First public-beta candidate. Four hardening waves land together:

- **Privacy-first posture** — zero telemetry by default, PII-scrubbed Sentry (optional), local Ollama AI, in-browser DuckDB-WASM.
- **Persistence tier** — bookmarks, pipelines, and query history persist to Postgres with offline/sync-safety fallback.
- **Error boundaries per route** — failures stay scoped to one panel; the rest of the workspace keeps working.
- **Security hardening** — tightened CSP, fail-fast JWT, XSS payload sweep, CodeQL gating wired up.
- **Accessibility** — jest-axe coverage across forms, shell, charts, and dialogs; explicit label associations restored.
- **Deployment fixes** — Docker quick start actually works end-to-end; reverse-proxy guide for public deployments.

See [CHANGELOG.md](./CHANGELOG.md) for the full list.

## What it is

DataLens is an open-source BI platform where your data **never leaves the browser** for analytical queries. SQL runs in-browser via DuckDB-WASM. AI features talk to your local Ollama instance. No cloud uploads, no vendor lock-in, no telemetry by default.

Think Metabase or Tableau, but privacy-first and self-hosted by design.

## Why it's different

| | Metabase / Tableau | Cloud BI (Observable, Hex) | **DataLens** |
|---|---|---|---|
| Data stays on-device | No | No | **Yes** |
| Works offline | No | No | **Yes** |
| AI without OpenAI | No | No | **Yes** (local Ollama) |
| Self-host in one command | Complex | No | **`docker-compose up`** |
| License | AGPL / Proprietary | Proprietary | **MIT** |

## Features

- **DuckDB-WASM in the browser** — analytical SQL over millions of rows, no backend round-trip
- **Local AI assistant** — NL → SQL via Ollama (or rule-based fallback when Ollama isn't running)
- **40+ chart types** — line, bar, pivot, sankey, heatmap, treemap, boxplot, and more
- **Dashboard builder** — compose multi-chart dashboards with saved layouts
- **ML workflows** — regression, clustering, classification, PCA, decision trees (scikit-learn backed)
- **Data pipelines** — 11 transform types, preview-at-each-stage, reusable pipeline definitions
- **Persistence** — bookmarks, pipelines, query history to Postgres with offline fallback
- **Sample datasets built-in** — 4,600+ rows of realistic ecommerce, payments, and web analytics data
- **Privacy defaults** — no telemetry, no tracking, PII-scrubbed optional Sentry
- **One-command self-host** — `docker-compose up` and you're running

## Quick start

### Option A — Docker (recommended)

```bash
git clone https://github.com/Aandrew-Kl/DataLens
cd DataLens
cp .env.example .env   # required: sets browser-reachable API/WS URLs
docker compose up
```

Then visit http://localhost:3000. The app comes with 3 sample datasets pre-loaded — click one to start exploring.

### Option B — local dev

```bash
# Frontend
npm install
npm run dev

# Backend (optional, only for persistence + ML)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Option C — enable local AI (optional)

```bash
# Install Ollama from https://ollama.com
ollama pull llama3.2
# DataLens auto-detects Ollama on http://localhost:11434
```

Without Ollama, DataLens falls back to a rule-based SQL generator for simple prompts.

## Tech stack

- **Frontend:** Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, DuckDB-WASM, Zustand
- **Backend:** FastAPI, PostgreSQL, Alembic, scikit-learn, pandas
- **AI:** Ollama (optional) via local HTTP
- **Testing:** Jest (1,828 unit tests), Playwright (E2E), k6 (perf baseline), hypothesis (fuzz)
- **CI:** GitHub Actions with npm audit, pip-audit, CodeQL, Dependabot

## Architecture

```
┌──────────── Browser ─────────────┐         ┌─── Your machine ───┐
│                                  │         │                    │
│  Next.js 16 UI                   │         │  Ollama (optional) │
│  ├── DuckDB-WASM (queries)       │◀──HTTP──▶│  localhost:11434   │
│  └── Chart/Dashboard/ML UI       │         │                    │
│                                  │         └────────────────────┘
│  Data NEVER leaves browser for   │
│  analytical queries              │         ┌─── Self-hosted ────┐
└──────────────────────────────────┘         │                    │
             │                               │   FastAPI backend  │
             └─── persistence/auth ─────────▶│   PostgreSQL       │
                   (saved queries,           │   (dashboards,     │
                    dashboards, users)       │    saved SQL, etc) │
                                             └────────────────────┘
```

Full architecture docs: [docs-site/content/architecture](./docs-site/content/architecture)

## Telemetry

DataLens ships with **zero telemetry** by default. Optional Sentry error tracking can be enabled by setting `NEXT_PUBLIC_SENTRY_DSN` — PII is scrubbed automatically. See the [observability guide](./docs-site/content/guides/observability.mdx).

## Troubleshooting

### Ollama isn't detected / AI assistant returns rule-based SQL
Verify Ollama is running: `curl http://localhost:11434/api/tags`. If the curl succeeds but DataLens still falls back, check that your browser isn't blocking cross-origin requests to `localhost:11434` (look at the browser console). Ollama auto-starts with a menu-bar icon on macOS; on Linux run `ollama serve` in a separate terminal.

### DuckDB-WASM fails to load (COOP/COEP errors)
DuckDB-WASM needs cross-origin isolation for SharedArrayBuffer. If you're self-hosting behind a proxy, make sure `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers are set. The bundled `next.config.ts` sets these — if you've customized the config, keep those two headers.

### Backend port conflict (`Address already in use: 8000`)
Another FastAPI/Uvicorn or generic service is holding port 8000. Either stop it (`lsof -i :8000` to find the PID) or launch on a different port: `uvicorn app.main:app --reload --port 8001` and set `NEXT_PUBLIC_API_URL=http://localhost:8001` in `.env`.

### Docker: browser can't reach the backend
If you see network errors only in the browser (but `curl` to the container succeeds), your `.env` is probably missing or pointing at the Docker-internal hostname. Copy `.env.example` → `.env` before running `docker compose up` — it sets `NEXT_PUBLIC_API_URL=http://localhost:8000`, which is what the browser (not the Next.js container) needs.

### Postgres migrations fail on startup
The backend runs `alembic upgrade head` on boot in strict mode. If migrations are behind, check `backend/alembic/versions/` for the expected head and run `alembic upgrade head` locally. In development, migration drift is warned, not fatal; in `ENVIRONMENT=production` the service refuses to start until the DB is at head.

### Tests fail locally but pass in CI
Make sure you've installed backend test deps (`pip install -r backend/requirements.txt`) and that the in-memory SQLite fixture is active (`DATABASE_URL=sqlite+aiosqlite:///:memory:` for unit tests). The frontend uses `jest` — run `npm test -- --clearCache` if a stale cache is the culprit.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs-site/content/contributing.mdx](./docs-site/content/contributing.mdx). Good first issues tagged `good-first-issue`.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, embed it, ship it.

## Screenshots

### SQL editor
![SQL editor with query and results](docs-site/public/images/screenshots/01-sql-editor.png)
Analytical SQL runs directly in the browser via DuckDB-WASM — no backend round-trip.

### Chart builder
![Chart builder](docs-site/public/images/screenshots/02-chart-builder.png)
40+ chart types with a point-and-click builder on top of any query result.

### Dashboard
![Dashboard with multiple charts](docs-site/public/images/screenshots/03-dashboard.png)
Compose multi-chart dashboards with saved layouts.

### AI assistant
![AI assistant converting natural language to SQL](docs-site/public/images/screenshots/04-ai-assistant.png)
Natural-language → SQL via local Ollama. Nothing leaves your machine.

### First-run experience
![Sample datasets gallery](docs-site/public/images/screenshots/05-sample-gallery.png)
Three realistic sample datasets pre-loaded for instant exploration.

---

**Made by [Andreas Klementidis](https://github.com/Aandrew-Kl) — solo open source.**

If DataLens helped you, star the repo to help other privacy-focused folks find it.
