# DataLens

AI-powered open-source data explorer

DataLens is a full-stack analytics workspace for exploring, transforming, and modeling data with a browser-first experience. It combines DuckDB-WASM for in-browser SQL, a Next.js frontend for interactive analysis, and a FastAPI backend for AI, machine learning, real-time streaming, and persistence.

## Features

- DuckDB-WASM for client-side SQL queries
  Run SQL directly in the browser for fast local exploration, profiling, previews, and ad hoc analysis without shipping every query to the server.
- AI-powered data analysis
  Generate SQL from natural language, summarize datasets and query results, and run sentiment analysis workflows from the app.
- Machine learning
  Train and inspect regression, clustering, classification, anomaly detection, PCA, and decision tree workflows backed by scikit-learn.
- Real-time data streaming via WebSocket
  Stream query progress and live updates into the UI for interactive, near-real-time analysis experiences.
- Interactive charts and pivot tables
  Build dashboards, pivot views, chart combinations, and visual drill-downs on top of active datasets.
- Data pipeline builder with 11 transform types
  Compose reusable transformations, preview stages, and export pipeline definitions for repeatable data preparation.
- Report generation with export
  Build narrative reports and analytical summaries with export workflows for PDF-style outputs and Excel datasets.

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS v4
- Backend: FastAPI, PostgreSQL
- Analytics engine: DuckDB-WASM

## Quick Start

The simplest way to run DataLens is with Docker Compose.

### Prerequisites

- Docker
- Docker Compose

### Run with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Open:

- App: `http://localhost:3000`
- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

The root `docker-compose.yml` starts:

- `frontend` on port `3000`
- `backend` on port `8000`
- `db` (PostgreSQL) on port `5432`

The backend container applies Alembic migrations automatically on startup.

To stop the stack:

```bash
docker compose down
```

## Development Setup

### Frontend

Recommended local versions:

- Node.js 22+
- npm 10+

Setup:

```bash
npm install
cp .env.example .env.local
npm run dev
```

The frontend runs at `http://localhost:3000`.

### Backend

Recommended local versions:

- Python 3.12+
- PostgreSQL 16+

Setup:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

The API runs at `http://localhost:8000`.

If you are running the full application manually, make sure PostgreSQL is available locally and update `backend/.env` as needed. If you use Ollama-backed AI features, ensure your local Ollama endpoint matches the configured `OLLAMA_URL`.

## Environment Variables

Use the sample files as the source of truth:

- Root app and Docker Compose defaults: [`.env.example`](./.env.example)
- Backend-only local development defaults: [`backend/.env.example`](./backend/.env.example)

Important variables defined in the examples include:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WS_URL`
- `DATABASE_URL`
- `JWT_SECRET`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `OLLAMA_URL`
- `OLLAMA_MODEL`

## Testing

### Frontend tests

Run Jest tests from the repository root:

```bash
npm test
```

### Backend tests

Run pytest from the backend directory:

```bash
cd backend
pytest
```

### End-to-end tests

Run Playwright tests from the repository root:

```bash
npx playwright test
```

You can also use the package script:

```bash
npm run test:e2e
```

## Project Structure

```text
.
├── src/                 # Next.js application code, UI, hooks, client utilities
├── backend/             # FastAPI app, services, models, schemas, migrations, tests
├── e2e/                 # Playwright end-to-end tests
├── docs/                # Project documentation and supporting notes
├── docker-compose.yml   # Full local stack for frontend, backend, and PostgreSQL
└── .env.example         # Example environment variables for local and Docker use
```

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow, code style, and pull request expectations.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
