# DataLens Architecture

DataLens is a browser-first analytics application. The core data path runs locally in the client with DuckDB-WASM, while optional AI assistance talks to a local Ollama instance through lightweight route handlers.

## System Overview

```text
                        +--------------------------------+
                        |   CSV / Excel / JSON files     |
                        +---------------+----------------+
                                        |
                                        v
                        +--------------------------------+
                        |  Parsers (`src/lib/parsers`)   |
                        +---------------+----------------+
                                        |
                                        v
  +-------------------+     +-------------------------------+     +----------------------+
  | Zustand stores    |<--->| React workspace + feature UI  |<--->| Export surfaces      |
  | dataset/query/ui/ |     | (`src/app/page.tsx`,          |     | CSV/JSON/SQL/PDF/    |
  | bookmark          |     |  `src/components/**`)         |     | HTML/share artifacts |
  +---------+---------+     +---------------+---------------+     +----------------------+
            |                                 |
            |                                 v
            |                 +-------------------------------+
            +---------------->| DuckDB-WASM (`src/lib/duckdb`)|
                              | in browser memory             |
                              +---------------+---------------+
                                              |
                                              v
                              +-------------------------------+
                              | Query results, profiling,     |
                              | charts, reports, transforms   |
                              +-------------------------------+

Optional AI path

  UI action
     |
     v
  `src/app/api/ai/*`
     |
     +--> `src/lib/ai/ollama-client.ts` --> local Ollama server (`localhost:11434`)
     |
     +--> `src/lib/ai/fallback.ts` when Ollama is unavailable or a response fails
```

## System Shape

- **No external analytics backend is required** for the core app experience.
- **Data stays local** during parsing, profiling, query execution, and most exports because DuckDB-WASM runs in the browser.
- **Optional AI remains local-first** because the intended LLM target is Ollama on the same machine or local network.
- **The current orchestration layer lives mostly in [`src/app/page.tsx`](../src/app/page.tsx)**, which composes many feature panels behind error boundaries.

## Component Hierarchy

```text
src/app/layout.tsx
└── src/app/page.tsx
    ├── layout components
    │   ├── header
    │   ├── sidebar
    │   ├── command palette
    │   └── workspace tabs
    ├── data domain
    │   ├── file ingest
    │   ├── profiling
    │   ├── tables
    │   ├── quality
    │   ├── transforms
    │   └── exports
    ├── query domain
    │   ├── natural language bar
    │   ├── SQL editor
    │   ├── SQL playground
    │   └── saved/history views
    ├── charts domain
    │   ├── chart builder
    │   ├── gallery
    │   ├── dashboard builder
    │   └── specialized charts
    ├── ai domain
    │   ├── assistant
    │   └── insights
    ├── report domain
    │   └── report builder
    └── shared ui
        ├── error boundary
        ├── modal
        ├── tabs
        ├── toast
        └── loading states
```

## State Management

DataLens uses lightweight Zustand stores for cross-cutting client state.

| Store | File | Responsibility |
| --- | --- | --- |
| Dataset store | `src/stores/dataset-store.ts` | Tracks loaded datasets and the active dataset selection. |
| Query store | `src/stores/query-store.ts` | Holds query history, last result, and querying status. |
| UI store | `src/stores/ui-store.ts` | Manages sidebar visibility and theme state. |
| Bookmark store | `src/stores/bookmark-store.ts` | Persists dataset bookmarks to `localStorage`. |

Guidelines:

- Put cross-workspace state in a store.
- Keep short-lived view state local to the component.
- Persist only state that improves user continuity, such as bookmarks or recent datasets.

## DuckDB-WASM Integration

DuckDB-WASM is the analytics engine.

- Initialization is lazy and singleton-style in `src/lib/duckdb/client.ts`.
- A shared async connection is reused after the first initialization.
- CSV and JSON are registered as in-memory files and loaded into DuckDB tables.
- Excel files are parsed before loading so the rest of the pipeline can treat them as tabular input.
- Query results are normalized to plain row objects, including `BigInt` conversion for serialization safety.
- Profiling logic lives in `src/lib/duckdb/profiler.ts` and feeds downstream views like summaries, quality panels, and charts.

## AI Pipeline

The AI path is optional and resilient.

### Request Flow

1. A client surface triggers an AI action such as query generation, SQL explanation, SQL fixing, or suggestion generation.
2. A route handler under `src/app/api/ai/*` receives the request.
3. The route checks Ollama availability through `checkOllamaHealth()`.
4. If Ollama is reachable, prompt builders and `chat()` are used to get an answer from the local model.
5. If Ollama is unavailable or the model response fails, the route falls back to deterministic helpers in `src/lib/ai/fallback.ts`.

### Current AI Endpoints

- `src/app/api/ai/query/route.ts`
- `src/app/api/ai/explain/route.ts`
- `src/app/api/ai/fix/route.ts`
- `src/app/api/ai/suggest/route.ts`
- `src/app/api/health/route.ts`

### Design Intent

- Core analytics must remain usable without AI.
- AI should enhance workflows, not gate them.
- Fallback behavior should return something useful when possible instead of failing hard.

## File Organization Conventions

| Path | Purpose |
| --- | --- |
| `src/app` | App Router entrypoints, layouts, route handlers, and global styling |
| `src/components` | Feature and shared UI components grouped by domain |
| `src/lib` | Non-UI logic such as AI helpers, DuckDB clients, parsers, exports, and utilities |
| `src/stores` | Zustand stores |
| `src/hooks` | Reusable hooks for persistence, keyboard shortcuts, local storage, and debouncing |
| `src/types` | Shared TypeScript types |
| `src/__tests__` | Unit and component tests |
| `__mocks__` | Jest mocks for heavy UI/runtime dependencies |
| `docker` | Dockerfile and Compose setup |

## Key Patterns

### Error Boundaries

- `src/components/ui/error-boundary.tsx` is used heavily to isolate failures in large feature panels.
- A broken chart, transform, or tool should not take down the whole workspace.

### Derived State

- Prefer computing display state from props, store values, or query results during render.
- Avoid effect chains that only exist to mirror state from one place into another.

### Lazy Initialization

- DuckDB is instantiated on demand rather than at app boot.
- Expensive surfaces should load only when the user needs them.
- AI calls begin with a health check so unavailable Ollama instances fail gracefully.

### Client Boundaries

- `"use client";` is explicit and should only be added when a file needs client-only behavior.
- Shared helpers and pure utilities should stay outside component files when possible.

### Local-First Persistence

- Use local storage selectively for bookmarks and recent user context.
- Persisted structures should be validated on read to avoid corrupting runtime state.

## Practical Guidance for New Work

- Extend existing domain folders before creating new top-level directories.
- Prefer adding narrow utilities or subcomponents over enlarging `src/app/page.tsx`.
- When a feature depends on DuckDB, keep SQL generation and execution concerns separate from the UI layer.
- When adding AI capabilities, define a deterministic fallback path before shipping the happy path.
