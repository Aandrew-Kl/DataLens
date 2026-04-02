<div align="center">

# DataLens

### AI-Powered Data Explorer — 100% Free, 100% Private

<p>
  <a href="./LICENSE">
    <img src="https://img.shields.io/github/license/Aandrew-Kl/DataLens?style=for-the-badge" alt="MIT License" />
  </a>
  <a href="./CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs Welcome" />
  </a>
  <a href="https://github.com/Aandrew-Kl/DataLens/stargazers">
    <img src="https://img.shields.io/github/stars/Aandrew-Kl/DataLens?style=for-the-badge" alt="GitHub Stars" />
  </a>
</p>

<p>
  Drop in a CSV, Excel, or JSON file and turn raw data into profiles, dashboards,
  SQL, charts, and local AI insights in seconds.
</p>

<p>
  No cloud dependency. No API keys. No paid credits. No data leaving your browser.
</p>

<p>
  <a href="#-quick-start"><strong>Quick Start</strong></a>
  ·
  <a href="#-feature-grid"><strong>Features</strong></a>
  ·
  <a href="#-docker"><strong>Docker</strong></a>
  ·
  <a href="#-tech-stack"><strong>Tech Stack</strong></a>
</p>

</div>

---

## 🚀 Why DataLens?

DataLens is built for people who want answers from data immediately without handing
that data to a third-party platform.

- **💸 Zero cost**: no API keys, no usage credits, no hidden SaaS meter running in the background.
- **🔒 Private by default**: your data stays in the browser for analysis, not on somebody else’s server.
- **⚡ Powerful under the hood**: DuckDB-WASM gives you a real analytical SQL engine running locally.
- **🧠 AI-powered locally**: Ollama brings natural language workflows and smart suggestions to your machine.

That means you can move from raw file to real insight fast:

- Upload a file and get instant profiling.
- Ask questions in plain English.
- Drop to SQL when you want exact control.
- Build charts, reports, and exports without leaving the app.
- Keep the entire workflow local-first from start to finish.

## 🎯 Built For

DataLens fits especially well when you need speed, control, and privacy:

- Developers exploring exports, logs, and product analytics snapshots.
- Analysts who want dashboards without spinning up a full BI stack.
- Founders and operators working from CSVs exported from business tools.
- Students and researchers who need a free local analysis environment.
- Security-conscious teams that cannot upload sensitive data to cloud AI products.

## 📁 Supported Data

DataLens is designed for the formats people actually receive every day:

- **CSV** for ad hoc exports and operational data.
- **Excel (`.xlsx`)** for stakeholder handoffs and spreadsheet-heavy workflows.
- **JSON** for API responses, structured events, and app data dumps.

## ✨ Feature Grid

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>📊 Data Profiling</strong><br />
      Instant column stats, type detection, null analysis, distributions, and quality signals the moment a dataset lands.
    </td>
    <td width="50%" valign="top">
      <strong>⚡ Auto Dashboards</strong><br />
      Generate metrics, KPIs, and chart suggestions automatically so you can start exploring before writing a single query.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>💬 Natural Language Queries</strong><br />
      Ask questions in plain English and let local AI translate intent into usable analysis workflows.
    </td>
    <td width="50%" valign="top">
      <strong>🧾 SQL Editor with Templates</strong><br />
      Write analytical SQL with built-in templates, syntax support, and a faster path to exact answers.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>📈 Chart Builder (10+ chart types)</strong><br />
      Build interactive visuals with core charts plus specialized visual analysis views, from bar and line to matrices and heatmaps.
    </td>
    <td width="50%" valign="top">
      <strong>🪄 Data Transforms</strong><br />
      Filter, sort, group, sample, clean, rename, and derive new fields without leaving the exploratory flow.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>🧮 Pivot Tables</strong><br />
      Slice measures across dimensions with interactive pivot workflows built for real dataset exploration, not toy demos.
    </td>
    <td width="50%" valign="top">
      <strong>🔀 Cross Tabulation</strong><br />
      Inspect category intersections and count patterns fast when you need structure across multiple dimensions.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>🚨 Anomaly Detection</strong><br />
      Surface outliers, unusual rows, and suspicious patterns before they distort dashboards, summaries, or downstream decisions.
    </td>
    <td width="50%" valign="top">
      <strong>🛡️ Data Quality Dashboard</strong><br />
      Track completeness, validity, uniqueness, consistency, and timeliness from one purpose-built quality surface.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>⏱️ Time Series Analysis</strong><br />
      Explore trends, moving averages, seasonality, and directional change without stitching together external notebooks.
    </td>
    <td width="50%" valign="top">
      <strong>🔵 Scatter Matrix</strong><br />
      Compare multiple numeric fields side by side and inspect pairwise relationships with optional category coloring.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>🧊 Correlation Matrix</strong><br />
      See numeric relationships at a glance with matrix-based correlation views for rapid exploratory analysis.
    </td>
    <td width="50%" valign="top">
      <strong>📦 Export (CSV/JSON/SQL/HTML reports)</strong><br />
      Ship cleaned data, query output, and shareable artifacts in practical formats people already use.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>🆚 Data Comparison</strong><br />
      Compare datasets side by side to spot drift, schema changes, quality deltas, and behavioral differences.
    </td>
    <td width="50%" valign="top">
      <strong>🗂️ Schema Viewer</strong><br />
      Inspect field types, shapes, and structural details without digging through raw tables manually.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>📚 Data Dictionary</strong><br />
      Document columns, preserve context, and export reusable dataset documentation directly from the app.
    </td>
    <td width="50%" valign="top">
      <strong>⌨️ Keyboard Shortcuts</strong><br />
      Move faster with power-user workflows for navigation, querying, dataset actions, and export flows.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>🌙 Dark Mode</strong><br />
      A first-class light and dark experience built for long exploratory sessions, not an afterthought theme toggle.
    </td>
    <td width="50%" valign="top">
      <strong>🧭 Onboarding Tour</strong><br />
      Guide new users from upload to insight with a polished first-run experience that reduces friction immediately.
    </td>
  </tr>
</table>

## 🧠 How It Works

DataLens keeps the full loop local:

1. Upload a CSV, Excel, or JSON file.
2. Parse it and load it into **DuckDB-WASM** in the browser.
3. Profile the dataset automatically for types, nulls, quality, and shape.
4. Explore through natural language, SQL, dashboards, transforms, and charts.
5. Export your findings as data files, SQL, or HTML-based reporting artifacts.

When Ollama is running locally, DataLens adds AI-assisted workflows without sending
your dataset to a remote LLM provider.

## ⚡ Quick Start

Clone the repo, install dependencies, run the app, and open it locally:

```bash
git clone https://github.com/Aandrew-Kl/DataLens.git datalens
cd datalens
npm install
npm run dev
```

Open `http://localhost:3000`

DataLens works without Ollama for core profiling, querying, visualization, and
exports. Local AI features become available when your Ollama server is running.

## 🐳 Docker

Run DataLens and Ollama together with Docker Compose from the project root:

```bash
docker compose -f docker/docker-compose.yml up
```

This brings up:

- **DataLens** on `http://localhost:3000`
- **Ollama** on `http://localhost:11434`

If you prefer detached mode, add `-d`.

## 🧱 Tech Stack

| Layer | Technology | Why it matters |
| --- | --- | --- |
| Framework | **Next.js 16** | Modern app foundation and fast local development |
| UI Runtime | **React 19** | Responsive, interactive client-side experience |
| Query Engine | **DuckDB-WASM** | Real analytical SQL in the browser |
| Local AI | **Ollama** | Private natural language workflows with no API keys |
| Language | **TypeScript** | Safer iteration and maintainable app logic |
| Styling | **Tailwind CSS v4** | Fast UI development with consistent design primitives |
| Charts | **ECharts** | Flexible, rich visualizations for exploratory analysis |
| Motion | **Framer Motion** | Polished transitions and interaction feedback |
| State | **Zustand** | Lightweight shared state for app workflows |

## 🤝 Contributing

Contributions are welcome.

If you want to improve DataLens, start with [CONTRIBUTING.md](./CONTRIBUTING.md)
for setup steps, coding conventions, testing guidance, and pull request
expectations.

Great contributions include:

- Bug fixes and regression tests
- UX refinements and accessibility improvements
- New analysis workflows and data tooling
- Documentation, onboarding, and developer-experience improvements

## 📄 License

DataLens is open source under the [MIT License](./LICENSE).

Use it commercially, self-host it privately, fork it, remix it, and build on top
of it.

## ⭐ Star History

This section is intentionally left as a launch-ready placeholder for the repo’s
growth chart.

When you want to switch it on, replace this block with:

```md
[![Star History Chart](https://api.star-history.com/svg?repos=Aandrew-Kl/DataLens&type=Date)](https://star-history.com/#Aandrew-Kl/DataLens&Date)
```

If DataLens helps you, star the repo and help make the chart worth embedding.
