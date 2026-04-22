# 90-second demo script

For video recording, screen-recording, or live demo. Target: 75-90 seconds, narrated voiceover.

## Setup (before recording)

- Fresh browser profile (no extensions, no prior DataLens state)
- 1920x1080 window, 125% system zoom for readability
- Ollama running with `llama3.2` pulled (verifies in step 3)
- `DataLens` open on `<!-- LIVE_URL -->` (or `http://localhost:3000`)
- Pre-prepared sample CSV: `public/demo-sales.csv` (already in repo)
- Sound on for the AI-typing effect (optional)

## Script

### 00:00–00:10 — Hook (10s)

> "DataLens is privacy-first AI data analytics that runs in your browser. Your data never touches a cloud. Let me show you."

_(Visual: open the landing page, land on the hero, click the primary CTA "Open workspace".)_

### 00:10–00:25 — Drop data (15s)

> "Drop a CSV — in this case, sales data. DataLens profiles every column, shows types, ranges, null counts, and top values. No upload to a server — this is all DuckDB-WASM running in the tab."

_(Visual: drag `demo-sales.csv` onto the dropzone. The profile cards populate.)_

### 00:25–00:45 — Ask a question (20s)

> "Now the AI assistant — I can ask 'which regions had the biggest revenue swing last quarter?' in plain English. This hits my local Ollama, not an API. SQL comes back, I can edit it, run it, and chart it."

_(Visual: open AI panel, type the prompt, hit Enter. SQL is generated. Click Run. Table populates. Click "Chart" → bar chart renders.)_

### 00:45–01:05 — Build a dashboard (20s)

> "Save the chart, add two more — a pivot table of category-over-time, a heatmap of order density by weekday. Drag them onto a dashboard, resize, save. Dashboards persist across sessions if I set up the optional backend."

_(Visual: fast-forward through creating 2 more charts, drag onto dashboard grid, save.)_

### 01:05–01:20 — Privacy & self-host (15s)

> "Zero telemetry. Zero cloud uploads. MIT licensed. Self-host with a single `docker compose up`. Works fully offline once loaded."

_(Visual: show network tab with no outbound API calls during queries, then zoom to `docker compose up` terminal.)_

### 01:20–01:30 — CTA (10s)

> "DataLens 0.9.0-beta is live. Link and GitHub in the description. If you care about keeping data local, give it a spin."

_(Visual: URL and GitHub overlay; star count visible.)_

## Recording tips

- Mute system notifications.
- Hide the bookmarks bar (Cmd-Shift-B on Chrome).
- Use `npm run dev` rather than production build — the Fast Refresh never happens during a scripted demo, and dev mode is visually identical.
- If the Ollama call feels slow, pre-cache the model with a dry run before recording. Nothing kills a demo like waiting 12s on first inference.

## Common pitfalls

- **DuckDB-WASM cold-start:** first query takes ~1.5s to compile. Either warm it before recording or lean into the "loading" state as a feature.
- **Ollama model-not-loaded error:** `ollama pull llama3.2` first. The error path is real but not demo material.
- **Dashboard drag-drop:** the snap-to-grid takes a moment on slower machines; rehearse the drag.
