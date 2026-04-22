# DataLens v0.9.0-beta — Privacy-first AI data analytics

First public-beta candidate. Privacy-first, local-first, and self-hostable in one command.

## TL;DR

DataLens is an open-source BI platform where your data **never leaves the browser** for analytical queries. SQL runs in-browser via DuckDB-WASM. AI features (NL → SQL) talk to your local Ollama instance. Zero telemetry, zero vendor lock-in, MIT licensed.

## Highlights

- **In-browser analytics** — DuckDB-WASM runs SQL over millions of rows with no backend round-trip.
- **Local AI** — natural-language queries go through your Ollama install (`llama3.2` by default). Rule-based fallback when Ollama isn't running.
- **40+ chart types, dashboards, ML workflows** — line, bar, pivot, sankey, heatmap, treemap; multi-chart dashboards with saved layouts; regression / clustering / classification / PCA via scikit-learn.
- **Persistence tier** — bookmarks, pipelines, and query history to Postgres via Alembic-managed migrations, with offline/sync-safety fallback to `localStorage`.
- **Custom error boundaries** — per-route error pages isolate failures to one panel instead of taking down the whole workspace. Polished 404 + critical-error fallback.
- **Security hardening** — tightened CSP, fail-fast JWT in non-development environments, OWASP XSS payload sweep, CodeQL workflow wired to the merge queue.
- **Accessibility** — jest-axe coverage across forms, shell, charts, and dialogs; explicit `htmlFor`/`id` label associations restored.
- **Deployment** — Docker Compose quick start with browser-reachable URLs; reverse-proxy guide for public deployments (Caddy example shipped).
- **Self-host in one command** — `docker compose up` and you're running.

## Install

### Docker (recommended)

```bash
git clone https://github.com/Aandrew-Kl/DataLens
cd DataLens
cp .env.example .env
docker compose up
```

Visit <http://localhost:3000>.

### Local dev

See the [README](https://github.com/Aandrew-Kl/DataLens#option-b-local-dev) for the full dev setup.

## What's different vs. Metabase / Tableau / Observable

| | Metabase / Tableau | Cloud BI (Observable, Hex) | **DataLens** |
|---|---|---|---|
| Data stays on-device | No | No | **Yes** |
| Works offline | No | No | **Yes** |
| AI without OpenAI | No | No | **Yes** (local Ollama) |
| Self-host in one command | Complex | No | **`docker compose up`** |
| License | AGPL / Proprietary | Proprietary | **MIT** |

## Full changelog

See [`CHANGELOG.md`](https://github.com/Aandrew-Kl/DataLens/blob/main/CHANGELOG.md) for the complete list. Summarized above, this release covers Waves 1–4 of hardening work: contract drift cleanup, deployment fixes, test surface expansion, security hardening, accessibility, and launch-artifact preparation.

## Known gaps (pre-1.0)

Tracked and ready to land post-beta:

- 4 XSS regression tests remain `it.skip` pending component-level fixes (no shipping-critical path).
- GitHub code scanning's `continue-on-error` flag on the `security` job does not gate merges until Settings → Security enables the feature on the repo.
- 4 Dependabot PRs (patch/minor bumps for next, posthog-js, posthog-node, eslint-config-next) ready to land after main CI re-enables post-billing-fix.

## Feedback

File an issue: <https://github.com/Aandrew-Kl/DataLens/issues>.
Star the repo if DataLens helped you; it's a solo project and visibility matters a lot for finding other privacy-minded users.

---

## Release command

Once CI is green on main, run:

```bash
gh release create v0.9.0-beta \
  --title "v0.9.0-beta — Privacy-first AI data analytics" \
  --notes-file docs/launch/release-notes-v0.9.0-beta.md \
  --prerelease
```

If you want the release tag to point at a specific commit rather than `HEAD` of `main`:

```bash
gh release create v0.9.0-beta <commit-sha> \
  --title "v0.9.0-beta — Privacy-first AI data analytics" \
  --notes-file docs/launch/release-notes-v0.9.0-beta.md \
  --prerelease
```

`--prerelease` keeps the "Latest" tag on any prior stable release until v1.0 lands.
