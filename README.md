<div align="center">

# DataLens

### 🔍 Free, open-source, AI-powered data explorer for private analytics in the browser

Drop in a CSV, Excel, or JSON file. Query with SQL or plain English. Build charts, clean data, run local AI, and keep every byte on your machine.

<p>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/github/stars/Aandrew-Kl/DataLens?style=social" alt="GitHub Stars" />
  <img src="https://img.shields.io/github/actions/workflow/status/Aandrew-Kl/DataLens/ci.yml?branch=main&label=build" alt="Build Status" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/API%20costs-%240-success" alt="Zero API Costs" />
  <img src="https://img.shields.io/badge/privacy-browser--first-0ea5e9" alt="Privacy First" />
</p>

<p>
  <a href="#-quick-start"><strong>Quick Start</strong></a>
  ·
  <a href="#-feature-showcase"><strong>Features</strong></a>
  ·
  <a href="#-screenshots"><strong>Screenshots</strong></a>
  ·
  <a href="#-architecture"><strong>Architecture</strong></a>
  ·
  <a href="#-contributing"><strong>Contributing</strong></a>
</p>

</div>

---

## ⚡ Why DataLens

DataLens is built for people who want serious analytics without SaaS lock-in, cloud uploads, or token bills.

- **100% free and open source** under the MIT License.
- **Zero API costs** because AI runs locally through Ollama.
- **Privacy-first** with DuckDB-WASM keeping analysis in browser memory.
- **No external backend or database required** for the core experience.
- **90+ React components** powering a dense, polished analytics workspace.
- **Glassmorphism UI + dark mode** designed for long analysis sessions.
- **Client-side analytics stack** with SQL, charts, pipelines, exports, and local AI.

> 📊 94 React components. 🤖 Local AI. 🔒 Browser-first privacy. 🎨 Beautiful dark UI.  
> DataLens feels like a full BI app, without the bill.

## 🚀 What You Can Do

| Category | Highlights |
| --- | --- |
| **🔍 Explore data** | Upload CSV, Excel, or JSON files, inspect schemas, profile columns, preview rows, compare datasets, and browse data dictionaries. |
| **📊 Analyze visually** | Build charts with ECharts, generate dashboards, use pivot tables, scatter matrices, correlation views, anomaly heatmaps, and report builders. |
| **🤖 Work with AI locally** | Ask natural-language questions, generate SQL, explain queries, fix broken SQL, and get auto-suggested dashboards through local Ollama. |
| **🧠 Go beyond charts** | Use anomaly detection, regression-assisted correlation analysis, clustering-friendly scatter exploration, statistical tests, and data quality workflows. |
| **⚙️ Transform data** | Clean nulls, rename columns, convert types, sample rows, validate datasets, build pipelines, join tables, and trace data lineage. |
| **📦 Export and share** | Export to CSV, JSON, SQL, PDF-style reports, HTML reports, and portable share artifacts. |
| **🎨 Enjoy the UX** | Command palette, onboarding tour, keyboard shortcuts, notifications, bookmarks, saved queries, snapshots, dark mode, and responsive glassmorphism styling. |

## ✨ Feature Showcase

### Querying & Exploration

- SQL playground with templates, formatting, history, and saved queries
- Natural-language query bar backed by local Ollama
- Dataset profiling, column statistics, frequency tables, crosstabs, and schema views
- Data bookmarks, changelog tracking, snapshots, and shareable configuration exports

### Visual Analytics

- Interactive chart builder and chart gallery
- Dashboard builder with metric cards and recommended visuals
- Scatter matrix, sparkline grid, geo chart, correlation matrix, and report builder
- Auto-generated insights panels for quality, distribution, anomalies, and extremes

### Data Engineering Workflows

- Data pipeline builder for filters, grouping, sampling, joins, and transforms
- Column rename, type conversion, null handling, duplicate detection, and validation tools
- Sample datasets and faker utilities for testing workflows quickly
- Export flows for raw data, derived views, and presentation-ready artifacts

### Local AI & ML-Lite

- Ollama-powered SQL generation, chart recommendations, explanations, and suggestions
- Rule-based fallback mode when Ollama is offline
- Anomaly detection surfaces for row and column outliers
- Regression-line support in correlation tooling and cluster-oriented exploratory views

## 🏁 Quick Start

### Local development

```bash
git clone https://github.com/Aandrew-Kl/DataLens.git
cd DataLens
npm install
npm run dev
```

Open `http://localhost:3000`.

### Optional local AI

```bash
cp .env.example .env.local
ollama serve
ollama pull llama3.2
```

If Ollama is not running, DataLens still works for profiling, SQL, charts, transforms, and exports. AI routes fall back to rule-based suggestions where possible.

### Docker

Run the app only:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Run the app with Ollama:

```bash
docker compose -f docker/docker-compose.yml --profile ollama up --build
```

## 🧰 Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Framework | Next.js 16 | App shell, routing, build pipeline, and local API routes |
| UI | React 19 | Interactive analytics workspace and feature surfaces |
| Language | TypeScript | Strict typing across app logic and state |
| Styling | Tailwind CSS v4 | Utility-first styling and dark-mode theming |
| Analytics Engine | DuckDB-WASM | In-browser SQL engine and local query execution |
| Visualization | ECharts + `echarts-for-react` | Interactive charts, matrices, and dashboards |
| Animation | Framer Motion | Motion, transitions, and micro-interactions |
| State | Zustand | Lightweight dataset, query, UI, and bookmark stores |
| Local AI | Ollama | Private LLM-powered query and analysis workflows |
| Testing | Jest, RTL, Playwright | Unit, component, and end-to-end coverage |
| Delivery | Docker | Containerized local deployment with optional Ollama service |

## 📸 Screenshots

| Workspace | SQL Playground |
| --- | --- |
| ![DataLens workspace](https://via.placeholder.com/1600x900/0f172a/e2e8f0?text=DataLens+Workspace+Overview) | ![DataLens SQL playground](https://via.placeholder.com/1600x900/111827/f8fafc?text=SQL+Playground) |

| Dashboard Builder | Data Pipeline Builder |
| --- | --- |
| ![DataLens dashboard builder](https://via.placeholder.com/1600x900/1e293b/e2e8f0?text=Dashboard+Builder) | ![DataLens data pipeline](https://via.placeholder.com/1600x900/0b1120/f8fafc?text=Data+Pipeline+Builder) |

| AI Querying | Export & Reports |
| --- | --- |
| ![DataLens local AI](https://via.placeholder.com/1600x900/172554/e2e8f0?text=Natural+Language+Queries+with+Ollama) | ![DataLens exports](https://via.placeholder.com/1600x900/020617/e2e8f0?text=Exports+to+CSV+JSON+SQL+PDF) |

## 🏗️ Architecture

DataLens is a browser-first analytics app with an optional local AI loop.

1. Files are parsed client-side and loaded into DuckDB-WASM.
2. Zustand stores coordinate datasets, query history, bookmarks, and UI state.
3. React feature panels render profiling, SQL, charts, reports, exports, and transformations.
4. Optional AI flows call local Ollama through the app’s lightweight route handlers, with fallback heuristics when Ollama is unavailable.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full system overview.

## 🤝 Contributing

Contributions are welcome, from bug fixes and tests to new workflows, docs, and visual polish.

- Start with [CONTRIBUTING.md](./CONTRIBUTING.md)
- Use the provided issue forms in [`.github/ISSUE_TEMPLATE`](./.github/ISSUE_TEMPLATE)
- Open focused pull requests with screenshots for UI changes

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Aandrew-Kl/DataLens&type=Date)](https://star-history.com/#Aandrew-Kl/DataLens&Date)

## 📄 License

DataLens is released under the [MIT License](./LICENSE).

Use it commercially, fork it freely, self-host it locally, and build on top of it.
