# Contributing to DataLens

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/datalens.git
cd datalens
npm install
npm run dev
```

## Project Structure

```
src/
  app/          → Next.js pages and API routes
  components/   → React components
  lib/          → Core logic (DuckDB, AI, parsers)
  stores/       → Zustand state management
  types/        → TypeScript interfaces
  hooks/        → React hooks
```

## Guidelines

- **TypeScript** — Strict mode, no `any` types
- **Components** — Use `"use client"` only when needed
- **Styling** — Tailwind CSS, support dark mode
- **State** — Zustand for global state, React state for local
- **AI** — All AI calls go through `/api/ai/*` routes
- **Data** — All data processing uses DuckDB-WASM in-browser

## Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run `npm run build` to verify
5. Submit a PR with a clear description

## Issues

Found a bug? Have an idea? Open an issue with:
- Clear title
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Screenshots if applicable
