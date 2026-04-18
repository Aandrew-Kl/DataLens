# Query load test

`load-tests/query.k6.js` exercises the authenticated `POST /api/ai/generate-query` endpoint with a 2 minute 10 -> 50 requests/second ramp and reports latency plus error rate.

## Run locally

Start the backend on `http://localhost:8000`, then run:

```sh
k6 run load-tests/query.k6.js
```

The script defaults to:

- `BASE_URL=http://localhost:8000/api`
- auto-register and login with a per-run test user when `AUTH_TOKEN` is not provided
- `QUERY_PATH=/ai/generate-query`
- `USE_OLLAMA=false` so the backend can run without Ollama for the baseline

To save the machine-readable summary locally:

```sh
mkdir -p load-tests/results
k6 run --summary-export=load-tests/results/query-summary.json load-tests/query.k6.js
```

## Optional environment variables

- `AUTH_TOKEN`: reuse an existing bearer token instead of auto-registering a test user
- `TEST_EMAIL`: existing user email to log in with
- `TEST_PASSWORD`: password for `TEST_EMAIL` or the generated test user
- `BASE_URL`: backend API base, including the `/api` prefix
- `QUERY_PATH`: override the query-generation route if it changes again
- `QUESTION`: override the natural-language prompt sent to the endpoint
- `TABLE_NAME`: override the sample table name in the request body
- `USE_OLLAMA=true`: include the Ollama-backed SQL generation path in the run
