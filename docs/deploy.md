# Deployment Notes

## Local Docker Compose

The root [`docker-compose.yml`](../docker-compose.yml) is optimized for a single machine:

- frontend on `http://localhost:3000`
- backend on `http://localhost:8000`
- PostgreSQL on `localhost:5432`

The browser-visible `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` intentionally point at `localhost`, not the Docker-internal `backend` hostname. A browser cannot resolve Docker service names from the host network.

## Production Recommendation

For an internet-facing deployment, put a reverse proxy in front of the frontend and backend so the browser talks to one public HTTPS origin. Rebuild the frontend image whenever you change `NEXT_PUBLIC_*`, because those values are embedded in the client bundle.

### Example Caddy Layout

```caddy
datalens.example.com {
  @backend path /api/* /ws/data-stream* /health /docs /redoc /openapi.json
  reverse_proxy @backend backend:8000

  reverse_proxy frontend:3000
}
```

### Matching Public Environment Values

```env
NEXT_PUBLIC_API_URL=https://datalens.example.com
NEXT_PUBLIC_WS_URL=wss://datalens.example.com/ws/data-stream
```

You can keep the backend on the Docker network behind the proxy. Only the proxy needs to publish ports 80 and 443.
