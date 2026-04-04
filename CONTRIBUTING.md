# Contributing to DataLens

Thank you for contributing to DataLens. This guide covers local setup, development workflow, code standards, and pull request expectations for the Next.js frontend and FastAPI backend.

## Architecture Overview

- Frontend: Next.js App Router in `src/app` with React 19 and TypeScript.
- Backend: FastAPI application in `backend/app` with Alembic migrations and pytest-based tests.
- Analytics engine: DuckDB-WASM runs client-side in the browser for local-first query execution and profiling.
- Supporting layers: Zustand stores manage client state, while optional AI and persistence flows are exposed through backend APIs and Next.js route handlers.

## Development Environment

### Frontend setup

Recommended versions:

- Node.js 22+
- npm 10+

From the repository root:

```bash
npm install
cp .env.example .env.local
npm run dev
```

The frontend runs at `http://localhost:3000`.

### Backend setup

Recommended versions:

- Python 3.12+
- PostgreSQL 16+

From `backend/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

The API runs at `http://localhost:8000`, with docs at `http://localhost:8000/docs`.

### Environment notes

- Root frontend settings live in `.env.local`, based on `.env.example`.
- Backend settings live in `backend/.env`, based on `backend/.env.example`.
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` should point at the local backend.
- `DATABASE_URL` must target a running PostgreSQL instance before applying migrations.
- `OLLAMA_URL` is optional for contributors who are not working on AI-assisted flows.

## Branching Strategy

- Create all feature work from `main`.
- Sync your local `main` before branching.
- Use short, descriptive branch names such as `feature/query-history`, `fix/login-validation`, or `docs/contributing-update`.
- Open pull requests back into `main` unless maintainers request a different target.

Example:

```bash
git checkout main
git pull origin main
git checkout -b feature/your-change
```

## Code Style

- TypeScript runs in strict mode. Keep types explicit where inference is unclear, and avoid weakening types with `any`.
- Follow the existing Next.js App Router structure: route entrypoints in `src/app`, reusable UI in `src/components`, shared logic in `src/lib`, and client state in `src/stores`.
- Use Tailwind CSS utilities for styling. Prefer extending existing component patterns over introducing one-off styling systems.
- Preserve the project's Glass UI conventions: layered surfaces, soft borders, translucency, and blur. Reuse established treatments such as the shared `glass` class and existing panel/input/button utility patterns before inventing new variants.
- Keep frontend and backend changes focused. Do not mix unrelated refactors into feature work.

## Testing Requirements

Before opening a pull request, run the required checks locally.

From the repository root:

```bash
npx tsc --noEmit
npm test
```

From `backend/`:

```bash
pytest
```

If your change affects both frontend and backend behavior, run both suites. If you touch user workflows that are covered by end-to-end tests, run `npm run test:e2e` as well.

## Pull Request Guidelines

- Use a descriptive PR title that explains the user-facing or architectural change.
- Include a short summary of what changed and why.
- Add a test plan listing the commands you ran and any manual verification you performed.
- Link the related issue when one exists.
- Keep each PR scoped to a single concern so reviewers can reason about it quickly.
- Update documentation when behavior, setup, or contributor workflow changes.

## Commit Message Conventions

This repository follows Conventional Commits.

Preferred format:

```text
type(scope): short summary
```

Examples:

- `feat(query): add saved query filters`
- `fix(auth): handle expired session redirect`
- `docs(contributing): expand local setup guide`
- `test(backend): cover dataset upload validation`

Common types include `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `build`.

## Review Checklist

Before requesting review, confirm that:

- Your branch is based on the latest `main`.
- TypeScript, Jest, and backend pytest checks pass locally.
- The UI follows existing Tailwind and Glass UI conventions.
- New behavior is documented in the PR description and linked issue, if applicable.
