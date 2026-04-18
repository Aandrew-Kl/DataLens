# Wave 2 Fresh Audit

**Headline verdict:** `4.5/10`. PRs `#13`-`#15` appear to have closed the auth and route-prefix issues from the previous review, but this codebase is still not in a clean "external reviewer can boot it and trust the backend-backed features" state. I found `10` new product bugs worth Wave 3 work, `6` of them high severity. The biggest pattern is misleading backend integration: several UI paths advertise backend/ML/streaming support, but the contracts are still broken or the deploy path cannot reach the backend at all.

## Contract sweep

- `POST /api/ai/generate-query` is still contract-broken. The frontend sends `{ question, table_name, columns }` from `src/lib/api/ai.ts:21-27`, the backend schema expects `schema` and/or `data` in `backend/app/schemas/ai.py:48-53`, and the route then throws both away and builds `NLQueryRequest` from `question` only in `backend/app/api/ai.py:93-95`. The SQL builder infers columns from `frame.columns` in `backend/app/services/nlp_service.py:167-190`; with an empty frame it falls back to generic `COUNT(*)` or `SELECT *` logic in `backend/app/services/nlp_service.py:217-231,275-282`. Result: backend mode in `src/components/ai/ai-query-generator.tsx:100-106` is materially worse than the local path. Severity: High. `QUICK FIX CANDIDATE`.
- `POST /api/analytics/ab-test` is not wired to the backend contract at all. The frontend posts `{ control, treatment }` in `src/lib/api/analytics.ts:31-35`, but the backend expects tabular data plus `group_column`, `metric_column`, `variant_a`, and `variant_b` in `backend/app/schemas/analytics.py:44-52`. The UI swallows the failure and silently flips to local compute in `src/components/analytics/ab-test-analyzer.tsx:263-286`, so the "backend" path is effectively fake. Severity: High. `QUICK FIX CANDIDATE`.
- `POST /api/analytics/forecast` has both request and response drift. The frontend sends `date_column` / `value_column` in `src/lib/api/analytics.ts:38-45`; the backend requires `date_col` / `value_col` in `backend/app/schemas/analytics.py:69-75`. The frontend expects `{ predictions, model }` in `src/lib/api/types.ts:129-132`; the backend returns `{ method, history_points, forecast_points, metrics }` in `backend/app/schemas/analytics.py:77-83`. The UI again hides the breakage with a silent fallback in `src/components/data/time-series-forecast.tsx:503-532`. Severity: High. `QUICK FIX CANDIDATE`.
- WebSocket streaming is also contract-broken. The backend requires `token` and `dataset_id` query params at connect time in `backend/app/api/ws.py:42-49`, but the client only appends `token` in `src/lib/api/websocket.ts:309-316`, and both hooks connect without a dataset identifier in `src/hooks/use-streaming-query.ts:213-219` and `src/hooks/use-websocket.ts:42-47`. Sending `{ type: "query", query }` later in `src/hooks/use-streaming-query.ts:249-252` cannot rescue the handshake. Severity: High. `QUICK FIX CANDIDATE`.
- No new shape drift showed up in `auth`, `datasets`, `sentiment`, `summarize`, `cohort`, or the core ML request objects. `bookmarks`, `pipeline`, `query history`, and `export` are a different problem: the frontend has no live API contract for them at all. Bookmarks are browser-local in `src/stores/bookmark-store.ts:3-4,53-58`, pipelines live only in Zustand memory in `src/stores/pipeline-store.ts:67-84`, and query history is in-memory only in `src/stores/query-store.ts:14-26`, while backend persistence helpers sit unused in `backend/app/api/deps.py:17-73`. That is not a field-name drift, but it does mean the "full-stack" story is still incomplete.

## Auth sweep

- I did **not** find a missing auth dependency in `backend/app/api/`. AI, analytics, datasets, and ML routes all require `Depends(get_current_user)`; the WebSocket path uses `_authenticate_user()` explicitly in `backend/app/api/ws.py:42-52`. This part looks materially improved.
- The register-success path is correct now: the backend returns an access token in `backend/app/api/auth.py:111-119`, and the frontend stores it only after a successful response in `src/lib/api/auth.ts:5-8`.
- Failure-path UX is still rough. Duplicate email is fine (`409` with string detail in `backend/app/api/auth.py:103-105`). But password validation failures come back as FastAPI/Pydantic `detail[]` arrays; the frontend error parser in `src/lib/api/client.ts:41-57` only lifts string `message/detail/error`, so a backend `422` degrades to a generic fallback instead of the real password rule. Database write failures are also uncaught in `backend/app/api/auth.py:107-110` and collapse into the generic `500` handler in `backend/app/main.py:320-324`.

## Local dev sweep

- README cold start is broken for the Docker path. `README.md:50-56` says `docker-compose up`, but root compose requires `.env` via `docker-compose.yml:21-22,40-41`. `docker compose -f docker-compose.yml config` fails immediately with `env file .../.env not found`. The root `.env.example` exists and already contains the needed defaults in `.env.example:1-28`, but README never tells the user to copy it. Severity: High. `QUICK FIX CANDIDATE`.
- Frontend local install is not stable here. `npm install` and `npm audit` both die instantly with `SecItemCopyMatching failed -50`. A second install attempt left a partial tree: `node_modules` exists, `node_modules/.bin` is missing, and `node_modules/next` is effectively empty. That is why `npm run build` later fails with `sh: next: command not found`.
- The repo does not document a Python floor in `README.md:60-71`, but the backend container standardizes on `python:3.12-slim` in `backend/Dockerfile:1`. This machine has `3.9` and `3.11`, not `3.12`, so the intended local parity path is underspecified even before install starts.
- I could not run `pip install -r requirements.txt`, `alembic upgrade head`, `uvicorn app.main:app --reload`, or the end-to-end registration flow because backend dependency install is blocked by outbound package-index access in this environment.

## Build + deploy sweep

- `npm run build` is currently non-functional in this checkout because the frontend install never produced a working `next` binary. `npm run start` is therefore blocked as well.
- The backend Dockerfile exists and is sane on paper in `backend/Dockerfile:1-27`, but I could not build it because the Docker daemon is unavailable in this environment.
- Root container deployment is broken even if the images build. `docker-compose.yml:8-9` injects `NEXT_PUBLIC_API_URL=http://backend:8000` and `NEXT_PUBLIC_WS_URL=ws://backend:8000/ws/data-stream`. Those are browser-visible variables, so the user's browser will try to resolve `backend`, which only exists on the Docker network, not on the host machine. Severity: Critical. `QUICK FIX CANDIDATE`.
- Compose syntax is not the main issue. `backend/docker-compose.yml` and `docker/docker-compose.yml` render cleanly through `docker compose ... config`; the broken part is the root bootstrap/env/public-URL setup.

## Frontend runtime sweep

- I could not complete a real browser pass because `npm run dev` is blocked by the broken install. So I cannot honestly claim "no console errors" or "all images/pages load."
- Static review still found a real runtime defect: nine workspace routes have no local error boundary wrapper (`src/app/(workspace)/dashboard/page.tsx:1`, `.../data-ops/page.tsx:1`, `.../explore/page.tsx:1`, `.../pivot/page.tsx:1`, `.../profile/page.tsx:1`, `.../reports/page.tsx:1`, `.../settings/page.tsx:1`, `.../sql/page.tsx:1`, `.../transforms/page.tsx:1`). The workspace layout only wraps `children` in `Suspense` at `src/app/(workspace)/layout.tsx:227-229`. There is an app-level `error.tsx`, so this is unlikely to be a literal white page, but a thrown child error will still take down the whole route instead of isolating the failing panel. Severity: Medium.

## Dependency health

- `npm outdated` and `npm audit` could not return a package list here; both abort immediately with `SecItemCopyMatching failed -50`.
- `python3.11 -m pip list --outdated --format=json` could not complete because outbound index lookups fail with repeated DNS/network errors against PyPI.
- I therefore could **not** produce a trustworthy current inventory of badly outdated packages or transitive CVEs in this environment. The dependency health signal I do have is itself bad: install/audit tooling is not runnable from a cold checkout, which is a release risk by itself.

## Dead code / broken imports

- I did not find production `TODO` / `FIXME` / `XXX` markers in `src` or `backend/app`. The flagged comments are test-only: `e2e/full-flow.spec.ts:6` and `backend/tests/test_data_service.py:190-192`.
- There is meaningful dead auth plumbing. `AuthProvider` in `src/components/auth/auth-provider.tsx:32` and `ProtectedRoute` in `src/components/auth/protected-route.tsx:11` exist and are tested, but `rg` only finds them in their own files and tests; root layout renders children directly in `src/app/layout.tsx:52-64`. That is not a user-facing break by itself, but it raises the cost of reasoning about real auth state.

## Test-suite health

- There are `3` skipped tests, all in `src/__tests__/security/xss.test.tsx:242,319,563`.
- These are not random. They target exported dashboard HTML, chart titles/labels, and `AiAssistant` rendering. I did not prove a live XSS exploit in this pass, but the skips are pointed at load-bearing product surfaces, so they are hiding risk rather than dead test code.

## Schema consistency

- The current model set (`users`, `datasets`, `saved_analyses`, `query_history`) appears to match the initial migration file: compare `backend/app/models/*.py` with `backend/alembic/versions/001_initial_tables.py:21+`. I did not spot an obvious model-without-migration drift.
- The bigger issue is that startup still runs `Base.metadata.create_all()` in `backend/app/main.py:327-333`. That masks Alembic drift and weakens the "migrations are the source of truth" guarantee. I could not run a clean from-scratch migration here because backend deps and DB bootstrap were blocked.

## Error boundary coverage

- Root app error UIs exist in `src/app/error.tsx:8` and `src/app/global-error.tsx:3`, so fatal errors should land somewhere user-visible.
- Coverage is still uneven inside the workspace. `analytics`, `charts`, `ml`, and `query` have explicit boundaries, but the nine routes listed above do not. The product result is a coarse full-route failure screen where a scoped fallback card would be expected.

## Top 10 new bugs

1. `Critical` - Root Docker deployment points the browser at internal hostnames via `docker-compose.yml:8-9`, so API and WS calls fail outside the Docker network.
2. `High` - Churn predictor uses `recency_days` as both feature and target (`src/components/analytics/churn-predictor.tsx:176-179`, `backend/app/services/analytics_service.py:29-50`), making "risk scores" fundamentally untrustworthy.
3. `High` - WebSocket streaming never supplies required `dataset_id` (`backend/app/api/ws.py:42-49`, `src/lib/api/websocket.ts:309-316`), so the streaming query path cannot actually work.
4. `High` - Backend AI query generation drops schema context (`src/lib/api/ai.ts:21-27`, `backend/app/api/ai.py:93-95`), so backend mode often emits generic SQL.
5. `High` - A/B testing backend integration is contract-incompatible and silently falls back (`src/lib/api/analytics.ts:31-35`, `backend/app/schemas/analytics.py:44-52`, `src/components/analytics/ab-test-analyzer.tsx:263-286`).
6. `High` - Forecast backend integration is contract-incompatible on both request and response (`src/lib/api/analytics.ts:38-45`, `backend/app/schemas/analytics.py:69-83`, `src/lib/api/types.ts:129-132`).
7. `High` - README Docker quick start is wrong because `.env` is required but undocumented (`README.md:50-56`, `.env.example:1-28`, `docker-compose.yml:21-22,40-41`).
8. `Medium` - Cold frontend install is unstable enough to leave a half-installed tree, which blocks `build`, `start`, and any real runtime audit.
9. `Medium` - Weak-password register failures lose their real validation messages because `src/lib/api/client.ts:41-57` ignores array `detail` payloads.
10. `Medium` - Nine workspace pages lack local error boundaries (`src/app/(workspace)/layout.tsx:227-229` plus the route files listed above), so a component crash becomes a whole-page failure.

## Recommended Wave 3 task briefs

- **Backend contract realignment.** Make the backend-backed AI, A/B, forecast, and streaming paths either truly compatible or remove the misleading toggles until they are.
- **Churn model semantics fix.** Define a real churn label, stop leaking the target into features, and verify the returned probability means "churn risk" rather than "last class in the classifier."
- **Cold-start hardening.** Fix README/bootstrap so `.env.example` is copied, local Python expectations are explicit, and a cold checkout can reach a working `npm install` + backend install path.
- **Container deploy repair.** Replace browser-facing `backend` URLs with host-reachable endpoints or a frontend proxy, then re-test root `docker-compose.yml` as the documented happy path.
- **Error isolation + auth UX polish.** Add route-level boundaries to the unwrapped workspace pages and surface FastAPI `422` validation arrays cleanly during registration.
