<div align="center">

# DataLens

### Privacy-first AI data analytics that runs in your browser.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1%2C679_passing-brightgreen.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](#)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](#)

**[Live Demo](#quick-start) · [Docs](./docs-site) · [Architecture](./docs-site/content/architecture) · [Report an Issue](https://github.com/Aandrew-Kl/DataLens/issues)**

</div>

---

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
- **Sample datasets built-in** — 4,600+ rows of realistic ecommerce, payments, and web analytics data
- **Privacy defaults** — no telemetry, no tracking, PII-scrubbed optional Sentry
- **One-command self-host** — `docker-compose up` and you're running

## Quick start

### Option A — Docker (recommended)

```bash
git clone https://github.com/Aandrew-Kl/DataLens
cd DataLens
docker-compose up
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
- **Backend:** FastAPI, PostgreSQL, scikit-learn, pandas
- **AI:** Ollama (optional) via local HTTP
- **Testing:** Jest (1,679 unit tests), Playwright (E2E)
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

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs-site/content/contributing.mdx](./docs-site/content/contributing.mdx). Good first issues tagged `good-first-issue`.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, embed it, ship it.

## Screenshots

> Screenshots and demo GIF coming with the v1.0 release.

- Hero: SQL editor + chart in the browser
- AI assistant: NL → SQL with local Ollama
- Dashboard builder: drag-and-drop multi-chart layouts
- ML workflow: clustering and regression UIs
- Architecture diagram: browser-first data flow

---

**Made by [Andreas Klementidis](https://github.com/Aandrew-Kl) — solo open source.**

If DataLens helped you, ⭐ the repo to help other privacy-focused folks find it.
