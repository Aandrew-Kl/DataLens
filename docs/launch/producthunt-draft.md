# Product Hunt — listing draft

## Tagline (≤60 chars)

**Privacy-first AI data analytics — in your browser.**

_(57 chars. Alternates: "Self-hosted, open source BI with local AI." (43), "AI data analytics without the cloud." (37).)_

## Name

DataLens

## Gallery assets (in priority order)

1. `og-image.png` (hero) — `public/og-image.png`
2. SQL editor screenshot — TODO: capture `docs-site/public/images/screenshots/01-sql-editor.png` after deploy
3. Chart builder — TODO: capture `02-chart-builder.png`
4. Dashboard — TODO: capture `03-dashboard.png`
5. AI assistant — TODO: capture `04-ai-assistant.png`
6. First-run wizard — TODO: capture `05-sample-gallery.png`

## Description

DataLens is an open-source, MIT-licensed BI platform where your data never leaves the browser for analytical queries. SQL runs in-browser via DuckDB-WASM. AI natural-language → SQL goes through your local Ollama. Zero cloud uploads, zero telemetry, zero vendor lock-in.

**What you can do:**

- Drop a CSV / Excel / JSON file and get instant AI-powered profiling
- Run analytical SQL over millions of rows without a backend round-trip
- Build charts from 40+ types (line, bar, pivot, sankey, heatmap, treemap, etc.)
- Compose multi-chart dashboards with saved layouts
- Run ML workflows (regression, clustering, classification, PCA) via scikit-learn
- Persist bookmarks, pipelines, and query history (optional self-hosted backend)
- Self-host with one command: `docker compose up`

**Why it's different from Metabase / Tableau / Observable:**

- Your data literally never leaves the browser for analytics
- AI features work with your local Ollama instead of OpenAI
- MIT license, not AGPL or proprietary
- One-command self-host, not a multi-service deployment

Built by a solo developer over 4 hardening waves (~10 weeks of post-MVP work). First public beta, feedback very welcome.

## First-comment tip (maker comment)

Hi Product Hunt — Andreas here, solo maker.

I built DataLens because the BI market forces a weird tradeoff: you either run something heavyweight and AGPL-licensed (Metabase), send your data to a cloud you don't control (Tableau Online, Observable, Hex), or roll your own. None of those felt right for "I just want to understand this CSV without leaking it."

The architecture is intentionally small: Next.js 16 front, DuckDB-WASM in the browser, optional FastAPI backend for persistence only. AI goes to your local Ollama — if you don't have Ollama, there's a rule-based fallback for simple prompts.

Known rough edges in 0.9.0-beta:

- First-load bundle is heavy (DuckDB-WASM is ~6MB). Pre-warming mitigates but doesn't eliminate.
- Ollama's rule-based fallback is "functional" at best.
- 4 XSS component-level fixes still pending (tracked, not shipping-critical).

Happy to answer questions on the architecture, the "no telemetry" posture, or why I picked DuckDB-WASM over SQLite-WASM.

## Topics / tags

- Data & Analytics
- Developer Tools
- Open Source
- Productivity
- Privacy

## Launch day pinned tweet

Will be cross-referenced from `twitter-launch-thread.md`.
