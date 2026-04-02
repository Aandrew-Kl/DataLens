# DataLens

**Drop a file. Ask anything. See everything.**

Open source AI-powered data explorer. No SQL needed. Runs 100% locally.

---

## What is DataLens?

DataLens turns any CSV, Excel, or JSON file into instant dashboards, charts, and insights — powered by AI that runs entirely on your machine.

- **Zero SQL required** — Ask questions in plain English
- **Zero API costs** — Powered by Ollama (local AI)
- **100% private** — Your data never leaves your machine
- **Instant insights** — Drop a file, see a dashboard in seconds

## Features

### Core
- **Drag & Drop** — CSV, Excel (.xlsx), and JSON files
- **Auto-Profiling** — Instant column analysis, types, distributions, nulls
- **AI Dashboard** — Auto-generated charts and KPIs on upload
- **Natural Language Queries** — "What were total sales by region?"
- **SQL Editor** — Full editor with syntax highlighting and auto-complete
- **DuckDB-WASM** — Analytical SQL runs in your browser, not a server

### Charts & Visualization
- **Chart Builder** — Interactive drag-and-drop chart configuration
- **6 Chart Types** — Bar, line, pie, scatter, histogram, area
- **Correlation Matrix** — Heatmap of column correlations
- **Missing Data Map** — Visual null data patterns

### Data Tools
- **Transform Panel** — Filter, sort, group, and computed columns
- **Join Builder** — Visual SQL join wizard for multi-dataset joins
- **Pivot Tables** — Interactive cross-tabulation with aggregation
- **Export Wizard** — CSV, JSON, SQL INSERT, Markdown, HTML export
- **Formula Editor** — Expression builder for computed columns

### Analytics
- **Outlier Detection** — IQR-based anomaly detection
- **Data Quality Scoring** — Automated completeness and quality assessment
- **Data Summary** — Natural language dataset summaries
- **Data Comparison** — Side-by-side dataset comparison

### Reports & History
- **Report Builder** — Create and export standalone HTML reports
- **Query History** — Browse and re-run past queries
- **Saved Queries** — Bookmark your favorite queries
- **SQL Templates** — 20+ pre-built, parameterized SQL templates

### UX
- **Dark Mode** — Full dark mode with system preference detection
- **Command Palette** — Cmd+K quick access to all features
- **Keyboard Shortcuts** — Power-user shortcuts (Cmd+D, Cmd+N, Cmd+/)
- **Sample Datasets** — Built-in demo data for instant exploration
- **Onboarding Tour** — First-time user guided tour
- **Self-Hosted** — Deploy with Docker Compose in one command

## Quick Start

### Option 1: Run locally (development)

```bash
# Clone the repo
git clone https://github.com/Aandrew-Kl/datalens.git
cd datalens

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000)

### Option 2: Docker Compose (production)

```bash
# Clone and run
git clone https://github.com/Aandrew-Kl/datalens.git
cd datalens

# Start everything (app + Ollama)
docker compose -f docker/docker-compose.yml up -d
```

This starts:
- **DataLens** on port 3000
- **Ollama** on port 11434 (auto-pulls llama3.2)

### Prerequisites for AI features

DataLens uses [Ollama](https://ollama.com) for AI features. Install it:

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.2
```

> **Note:** DataLens works WITHOUT Ollama — you get full data profiling, tables, and manual querying. Ollama adds natural language queries and auto-dashboards.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Apache ECharts |
| In-Browser DB | DuckDB-WASM |
| AI | Ollama (local LLM) |
| State | Zustand |
| Animations | Framer Motion |

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Drop File  │────▶│  DuckDB-WASM │────▶│  Auto-Profile│
│  (CSV/XLSX) │     │  (In-Browser) │     │  (Instant)   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │   Ollama    │
                    │  (Local AI) │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Auto-    │ │ NL Query │ │ Chart    │
        │ Dashboard│ │ → SQL    │ │ Suggest  │
        └──────────┘ └──────────┘ └──────────┘
```

**Key insight:** DuckDB-WASM runs analytical queries directly in your browser. Your data never hits a server for analysis. Ollama runs AI locally for natural language processing.

## Configuration

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Available options:

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.2` | Model for AI features |

## Supported Models

Any Ollama model works. Recommended:

| Model | Speed | SQL Quality | RAM |
|-------|-------|-------------|-----|
| `llama3.2` | Fast | Good | 4GB |
| `qwen2.5:14b` | Medium | Excellent | 10GB |
| `deepseek-r1:8b` | Medium | Very Good | 6GB |
| `mistral` | Fast | Good | 4GB |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development
npm run dev       # Start dev server
npm run build     # Production build
npm run lint      # Run linter
```

## License

MIT License — free for personal and commercial use.

---

Built with AI by the community. Star this repo if you find it useful!
