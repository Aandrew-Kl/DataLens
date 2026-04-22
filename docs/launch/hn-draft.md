# Hacker News — submission

## Title

Show HN: DataLens – Privacy-first AI data analytics that runs in your browser

_(Under 80 chars, "Show HN" prefix per HN guidelines, no emojis, no hype words.)_

## URL

`<!-- LIVE_URL -->` (or GitHub repo if demo isn't up yet: `https://github.com/Aandrew-Kl/DataLens`)

## Body (150 words)

Hi HN. I'm Andreas, solo developer.

DataLens is an open-source BI platform where your data never leaves the browser for analytical queries. SQL runs in-browser via DuckDB-WASM. AI features talk to your local Ollama instance. No cloud uploads, no vendor lock-in, zero telemetry by default.

You drop a CSV/Excel/JSON file, get instant profiling, then build charts, dashboards, and ML models (regression, clustering, classification) on top. Natural-language queries go through Ollama locally, with a rule-based fallback when it isn't installed.

Self-hostable in one command: `docker compose up`. MIT licensed. Optional FastAPI backend for persistence (bookmarks, pipelines, query history) — but the analytics core works without any backend.

Built because Metabase is AGPL + heavyweight, Tableau is a closed cloud service, and Observable/Hex require sending data to their servers. Privacy shouldn't be a paid feature.

Would love feedback on the self-hosting story and whether the Ollama integration is useful in practice.

## First comment (author)

A few things I learned building this I didn't expect:

- DuckDB-WASM + SharedArrayBuffer means a ~6MB bundle before you can run a single query. Worth it for the in-browser story, but brutal on slow connections. Pre-warming the WASM on hover over "Open workspace" helps.
- Ollama's HTTP API is trivial to integrate but the UX gap between "user has Ollama" and "user doesn't" is huge. The rule-based fallback is worse than you'd guess — good enough to look real, not good enough to trust.
- Getting to a clean FE↔BE contract took 4 hardening waves of work post-MVP. The field-naming and endpoint-prefix drift was invisible until I added shape-checking tests.

Happy to answer questions about the architecture, the DuckDB-WASM tradeoffs, or the "privacy by default" posture.
