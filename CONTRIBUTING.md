# Contributing to DataLens

DataLens is a local-first data explorer built with Next.js App Router, React 19, TypeScript, DuckDB-WASM, and Ollama-backed AI helpers. This document covers the expected setup, repo structure, coding conventions, testing, and pull request process for contributors.

## Development Setup

### Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Git for branching and pull requests
- Ollama if you are working on AI routes or prompts locally

### Install and Run

```bash
git clone https://github.com/<your-username>/datalens.git
cd datalens
npm ci
npm run dev
```

Open `http://localhost:3000` after the dev server starts.

### Environment Variables

Most of the app works without local AI. If you need AI routes, copy the example env file and point it at your Ollama instance:

```bash
cp .env.example .env.local
```

The default local Ollama URL used by the app is `http://localhost:11434`.

## Project Structure

Most application code lives in `src/`.

- `src/app`: App Router pages, layouts, global styles, and route handlers such as `src/app/api/*`.
- `src/components`: Reusable UI and feature components grouped by domain such as `data`, `query`, `layout`, `settings`, and `ui`.
- `src/lib`: Non-UI logic including DuckDB helpers, AI clients, parsers, and shared utilities.
- `src/stores`: Zustand stores for query state, datasets, UI state, and bookmarks.
- `src/types`: Shared domain and UI types.
- `src/hooks`: Reusable hooks for persistence, debouncing, keyboard shortcuts, and local storage.
- `src/__tests__`: Jest and React Testing Library coverage for components, stores, and utilities.
- `e2e`: Playwright end-to-end coverage.

## Component and Code Conventions

### TypeScript

- TypeScript strict mode is on. Keep new code fully typed and avoid `any` unless there is a concrete, documented reason.
- Reuse existing types from `src/types` before introducing new interfaces.
- Prefer the `@/` import alias for anything under `src`.
- Keep helper functions and store contracts explicit rather than relying on implicit structural typing.

### React and Next.js

- Default to Server Components in the App Router. Add `"use client";` only when the file needs hooks, browser APIs, local state, or client-only libraries.
- Keep rendering, state management, and non-UI logic separated. If a component starts doing too much, move logic into `src/lib`, `src/hooks`, or a store.
- Follow React 19 rules when changing component logic:
  - Do not call `setState` from effects just to derive state that can be computed during render.
  - Do not read from or write to refs during render.
  - Keep effect logic for synchronization with the outside world, not for routine data shaping.

### Styling, Motion, and Icons

- Use Tailwind CSS v4 for styling.
- Match the existing UI language in `src/app/globals.css` and current components instead of inventing one-off utilities.
- Use `framer-motion` for motion. Keep transitions typed with literal values when needed, for example `ease: "easeOut" as const`.
- Use `lucide-react` for icons instead of mixing icon libraries.
- Keep accessibility intact: semantic HTML, keyboard access, visible focus states, and clear labels are expected.

### State and Utilities

- Shared client state belongs in Zustand stores under `src/stores`.
- Local component state should stay local unless multiple surfaces need to coordinate.
- Reusable non-UI logic belongs in `src/lib`.
- Add comments only when the intent is not obvious from the code.

### Linting and Style

- ESLint is the baseline for style and correctness checks. Run `npm run lint` before opening a pull request.
- Keep formatting and naming consistent with nearby files rather than introducing a second style.
- Prefer small, composable functions over large conditional blocks.

## Testing Guidelines

Use the test type that matches the change:

- Jest + React Testing Library for units, hooks, utilities, stores, and most component behavior.
- Playwright for end-to-end flows that cross route, state, and browser boundaries.

Commands:

```bash
npm test
npm run test:e2e
npm run lint
```

Guidelines:

- Add or update tests whenever behavior changes in `src/lib`, `src/stores`, parsers, AI prompt logic, or complex components.
- Put unit tests in `src/__tests__` or next to the file as `*.test.ts` or `*.test.tsx`.
- Prefer focused regression tests when fixing bugs.
- For UI changes, verify the relevant path in the browser in addition to automated checks.

## Common Contribution Workflows

### Add a New Component

1. Create the component in the closest domain under `src/components`.
2. Add `"use client";` only if the component actually needs client behavior.
3. Type the props explicitly and reuse shared types from `src/types` where possible.
4. Use Tailwind for styling, `lucide-react` for icons, and `framer-motion` for animation if needed.
5. Add or update the relevant unit test in `src/__tests__/components`.

### Add a New Test

1. For utilities, parsers, and stores, add a Jest test under `src/__tests__/lib` or `src/__tests__/stores`.
2. For UI behavior, add a React Testing Library test under `src/__tests__/components`.
3. For full-browser flows, add a Playwright spec under `e2e`.
4. Keep fixtures small and assertions behavior-focused.

### Add a New DuckDB Query

1. If you are adding a reusable query helper, start in `src/lib/duckdb/client.ts` and build on `getConnection()` or `runQuery()`.
2. If you are adding a SQL template for the query UI, update `src/lib/utils/sql-templates.ts` with a new `SQL_TEMPLATES` entry and parameter metadata.
3. If the query needs UI wiring, connect it in the relevant query or data component under `src/components/query` or `src/components/data`.
4. Add tests for the query builder, template rendering, or consumer behavior in `src/__tests__/lib` or `src/__tests__/components`.

## Pull Request Process

1. Create a focused branch for one logical change.
2. Keep the diff reviewable. Avoid mixing refactors with unrelated behavior changes.
3. Run `npm run lint` and the relevant tests before requesting review.
4. Fill out the pull request template clearly:
   - summarize the change
   - list the type of change
   - explain how it was tested
   - attach screenshots for UI work
5. Link related issues or discussions when applicable.
6. Open a draft PR early if you need direction or architectural feedback.

## Commit Messages

Conventional Commit style is preferred:

```text
type(scope): short summary
```

Examples:

- `feat(charts): add correlation matrix legend`
- `fix(query): handle empty result sets in sql editor`
- `refactor(stores): simplify dataset selection flow`
- `test(utils): cover csv export edge cases`
- `docs(contributing): expand contributor workflow`

## Before Requesting Review

- Run `npm run lint`.
- Run the relevant Jest or Playwright tests for your change.
- Verify light and dark mode for UI updates.
- Confirm icons come from `lucide-react`.
- Confirm motion uses `framer-motion` and keeps literal transition values typed when needed.
- Update tests, docs, or shared types when your change affects them.

## Questions

If you are unsure about scope or direction, open a draft PR or discussion early. Early alignment is better than a large late rewrite.
