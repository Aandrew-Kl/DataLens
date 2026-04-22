@AGENTS.md

# DataLens — Agent Orientation

Privacy-first BI: DuckDB-WASM analytical SQL in the browser, FastAPI backend for ML / NL→SQL / forecasting, local Ollama for AI. MIT, self-host in one command.

## Architecture (minimum you need)

- **Frontend** (`src/`): Next.js 16, React 19, TypeScript strict, Zustand, ECharts, `@duckdb/duckdb-wasm`. All analytical queries run in the browser — the backend only handles ML, auth, persistence, and NL→SQL assist.
- **Backend** (`backend/app/`): FastAPI, SQLAlchemy, Alembic, Pydantic v2, scikit-learn, openpyxl. 10 API routes, 7 services. Thin wrapper pattern — most endpoints call a sklearn/stats routine and return JSON.
- **Persistence**: Postgres via SQLAlchemy + Alembic. `Base.metadata.create_all()` still runs at startup — Alembic is the source of truth; dropping create_all is a Wave 4 item.
- **Tests**: `jest` + RTL + `jest-axe` + `hypothesis` fuzz + `playwright` e2e + `k6` load.

See `AGENTS.md` for the Next.js warning (breaking API changes vs. training data).

## Import conventions

- Frontend uses `@/` for `src/` absolute imports — prefer over deep relatives.
- Backend uses `app.` absolute imports — never `from ..thing`.

## Testing

- Backend env: `DATABASE_URL=sqlite+aiosqlite:///:memory: JWT_SECRET=test-only-secret python -m pytest`
- Frontend: `npm test` — respects `coverageThreshold` in `jest.config.ts` (ratchet floors, never lower).
- E2E: `npm run test:e2e` (Playwright).

## Contract discipline

Frontend and backend share field names across AI / analytics / ML routes. A contract drift test lives under `src/__tests__/lib/api/` — run it after any API change. The Wave 2 audit surfaced 4 high-severity drifts (AI generate-query, A/B test, forecast, WebSocket handshake); Wave 3 closes them — do not reintroduce.

## Hard rules

1. Never mock browser DuckDB in tests that claim to exercise query logic — `__mocks__/duckdb-wasm.ts` is for rendering smoke tests only.
2. Keep `NEXT_PUBLIC_*` variables browser-reachable. `backend:8000` works only on the Docker network, never from the host browser.
3. Churn model (`backend/app/services/analytics_service.py`): target column cannot appear in feature_columns — enforced server-side after the label-leakage bug.
4. Privacy default is telemetry-off. Do not add tracking without surfacing it in `src/components/settings/telemetry-preferences.tsx`.

## Quality gates (ratchet floors in `jest.config.ts`)

branches 57 · functions 74 · lines 78 · statements 76

Never lower without explicit user OK.
