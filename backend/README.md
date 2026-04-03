# Backend setup

## Quick start

From backend/:

1. Start local services:

```bash
docker-compose up -d
```

2. Install dependencies:

```bash
python -m pip install -r requirements.txt
```

3. Apply database migrations:

```bash
alembic -c alembic.ini upgrade head
```

4. Run the API:

```bash
uvicorn app.main:app --reload
```

You can also bind host and port explicitly:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## API documentation overview

- The API is exposed as a FastAPI application in `app.main`.
- OpenAPI documentation is available at `http://localhost:8000/docs`.
- Alternative docs (ReDoc) are available at `http://localhost:8000/redoc`.
- Endpoints cover authentication, dataset management, saved analyses, and query history workflows.

## Environment variables

- `DATABASE_URL`: Async SQLAlchemy connection string for PostgreSQL.
- `JWT_SECRET`: Secret used to sign JWT tokens.
- `OLLAMA_URL`: URL for the local Ollama service used by prompt or analytics features.
