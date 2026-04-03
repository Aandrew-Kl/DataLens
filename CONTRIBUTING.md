# Contributing to DataLens

Thanks for contributing to DataLens. This project is a privacy-first, local-first analytics workspace built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, DuckDB-WASM, ECharts, and Ollama.

## Development Setup

### Prerequisites

- Node.js 22+
- npm 10+
- Git
- Ollama for local AI workflows
- Docker Desktop if you want the containerized setup

### Local Setup

```bash
git clone https://github.com/Aandrew-Kl/DataLens.git
cd DataLens
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

### Optional Ollama Setup

```bash
ollama serve
ollama pull llama3.2
```

The app works without Ollama for core profiling, SQL, charts, pipelines, and exports. AI routes use rule-based fallbacks where available.

### Docker Setup

```bash
docker compose -f docker/docker-compose.yml up --build
docker compose -f docker/docker-compose.yml --profile ollama up --build
```

The second command starts the bundled Ollama service as well.

## Contribution Workflow

1. Fork the repository and create a focused branch from `main`.
2. Keep each branch scoped to one logical change.
3. Update tests and docs when behavior changes.
4. Run lint, tests, and build checks before opening a PR.
5. Fill out the pull request template completely.

## Code Style Guidelines

### TypeScript

- TypeScript strict mode is the baseline. Keep new code fully typed.
- Avoid `any` unless there is a clear reason and the tradeoff is documented in code.
- Reuse types from `src/types` before creating new interfaces.
- Prefer the `@/` import alias for files under `src`.

### React and Next.js

- Use `"use client";` only when the file truly needs hooks, browser APIs, local storage, or client-only libraries.
- Keep rendering concerns in components and move reusable logic into `src/lib`, `src/hooks`, or `src/stores`.
- Prefer derived state during render over effect-driven synchronization.
- Do not add new global patterns that fight the current App Router structure.

### Components

- Use `PascalCase` for component names and `kebab-case.tsx` for filenames.
- Keep feature components in the closest domain folder under `src/components`.
- Reuse the existing shared primitives from `src/components/ui` before creating a new one-off UI element.
- Wrap risky, heavy, or isolated surfaces in `ErrorBoundary` when failure should not break the whole workspace.

### Styling and Visual Language

- Use Tailwind CSS v4 utilities and existing design tokens.
- Match the project’s glassmorphism style by reusing the `.glass` class, blur surfaces, subtle borders, and dark-mode-aware colors.
- Keep dark mode first-class. New UI should read well in both themes.
- Use `lucide-react` for icons and `framer-motion` for motion instead of mixing libraries.

### Linting and Formatting

- Run `npm run lint` before opening a PR.
- Keep diffs Prettier-compatible and consistent with the surrounding files.
- If your editor runs Prettier automatically, use default formatting and avoid unrelated reformat-only changes.

## Testing Requirements

Use the narrowest test that proves the change.

- `Jest + React Testing Library` for units, utilities, stores, hooks, and component behavior
- `Playwright` for end-to-end flows across upload, query, charting, and export workflows

### Commands

```bash
npm run lint
npm test
npx tsc --noEmit
npm run test:e2e
```

### Testing Conventions

- Add or update tests whenever behavior changes.
- Prefer regression tests for bug fixes.
- Keep fixtures small and assertions behavior-focused.
- Use the existing mocks in `__mocks__/framer-motion.tsx` and `__mocks__/echarts-for-react.tsx` instead of reinventing mock layers.
- Reuse the browser API shims in `jest.setup.ts` for things like `ResizeObserver`, `requestAnimationFrame`, and `URL.createObjectURL`.

## File and Naming Conventions

| Area | Convention |
| --- | --- |
| Components | `src/components/<domain>/<file-name>.tsx` |
| Hooks | `src/hooks/use-*.ts` |
| Stores | `src/stores/*-store.ts` exporting `useXStore` hooks |
| Utilities | `src/lib/**` |
| Tests | `src/__tests__/**` or `*.test.ts(x)` next to the code |
| Types | `src/types/*.ts` |

## Pull Request Process

1. Open a draft PR early if the scope or direction is uncertain.
2. Link the related issue or discussion when one exists.
3. Describe the problem, the change, and the verification steps.
4. Include screenshots or recordings for UI changes.
5. Keep refactors separate from feature or bug-fix work whenever possible.

### Before Requesting Review

- `npm run lint` passes
- Relevant Jest tests pass
- `npx tsc --noEmit` passes
- `npm run test:e2e` runs for changes that affect full workflows
- Docs are updated when behavior or DX changes
- Screenshots are attached for visible UI changes

## Issue Templates

Use the repo’s issue forms whenever possible.

- Bug reports: [`.github/ISSUE_TEMPLATE/bug_report.yml`](./.github/ISSUE_TEMPLATE/bug_report.yml)
- Feature requests: [`.github/ISSUE_TEMPLATE/feature_request.yml`](./.github/ISSUE_TEMPLATE/feature_request.yml)

Good reports include a clear problem statement, reproduction steps, environment details, and screenshots when relevant.

## Good First Contributions

- Improve documentation and onboarding
- Tighten tests around parsing, exports, and stores
- Polish accessibility and keyboard flows
- Add focused analytics or visualization improvements without broad refactors

## Questions

If you are unsure about a change, open an issue or a draft PR early. Small, reviewable contributions move fastest.
