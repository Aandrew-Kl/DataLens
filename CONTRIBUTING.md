# Contributing to DataLens

Thank you for contributing to DataLens.

DataLens is an open source, local-first data explorer built with Next.js, TypeScript, DuckDB-WASM, and Ollama. We welcome thoughtful contributions of all sizes.

This guide covers local setup, project structure, coding conventions, testing, pull requests, and commit messages.

## Local Setup

### Prerequisites

- Use a recent LTS version of Node.js and npm.
- Git is required for branching and pull requests.
- Ollama is optional unless you are working on AI-powered features.

### Start the App

```bash
git clone https://github.com/<your-username>/datalens.git
cd datalens
npm install
npm run dev
```

Open `http://localhost:3000` after the dev server starts.

If you are working on AI routes or prompt logic, create a local environment file:

```bash
cp .env.example .env.local
```

Most contributions do not require Ollama to be running.

## Project Structure

The application uses the Next.js App Router and keeps most source code under `src/`.

- `src/app` contains routes, layouts, global styles, and API handlers.
- `src/components` contains reusable UI and feature components grouped by domain.
- `src/lib` contains non-UI logic such as DuckDB helpers, AI utilities, parsers, and shared functions.
- `src/stores` contains Zustand stores for shared client state.
- `src/types` contains shared TypeScript types and domain models.
- `src/hooks` contains reusable React hooks.
- `src/__tests__` contains Jest-based tests.

## Coding Conventions

### TypeScript

- TypeScript strict mode is enabled. Keep new code type-safe and avoid `any` unless there is a documented reason.
- Define explicit prop types, store contracts, and utility signatures.
- Reuse existing shared types from `src/types` before adding new ones.
- Use the `@/` import alias for modules under `src`.

### React and Next.js

- Follow the App Router patterns already used in `src/app`.
- Add `"use client";` only when a component genuinely needs client-side behavior.
- Keep files focused. Split components when rendering, state, and business logic start to blur together.

### Styling

- Use Tailwind CSS v4 for styling.
- Treat dark mode as a first-class requirement. New UI should work in both light and dark themes.
- Follow the existing dark mode strategy from `src/app/globals.css`, including `dark:` utilities and the `.dark` class.
- Reuse existing spacing, border, and surface patterns where possible.

### Icons, Motion, and State

- Use `lucide-react` for icons.
- Use `framer-motion` for animations and transitions.
- Keep motion purposeful, subtle, and compatible with reduced-motion expectations.
- Use Zustand for shared client state, and keep stores small, typed, and predictable.
- Keep transient UI state local unless it truly needs to be shared.

### General Guidelines

- Prefer readable, composable functions over deeply nested logic.
- Put reusable, testable logic in `src/lib`.
- Add comments sparingly and only when intent is not obvious from the code.
- Preserve accessibility basics such as semantic HTML, labels, keyboard support, and visible focus states.

## Testing

Run tests before opening a pull request:

```bash
npm test
```

Run linting for every contribution:

```bash
npm run lint
```

- Add or update tests when changing utilities, stores, parsers, AI prompt logic, or any behavior with meaningful branching.
- Place tests in `src/__tests__` or alongside the relevant file using `*.test.ts` or `*.test.tsx`.
- If you fix a bug, add a regression test whenever practical.

## Pull Request Guidelines

- Keep pull requests focused and easy to review.
- Rebase on the latest default branch before opening a PR.
- Use a clear PR title and explain what changed, why it changed, and how you validated it.
- Link related issues or discussions when applicable.
- Include screenshots or short recordings for UI changes.
- Call out tradeoffs, follow-up work, or known limitations in the PR description.
- Avoid mixing unrelated refactors with feature work.

## Commit Message Format

Use clear, scoped commit messages. Conventional Commits are preferred:

```text
type(scope): short summary
```

Examples:

- `feat(charts): add correlation matrix legend`
- `fix(query): handle empty result sets in sql editor`
- `refactor(stores): simplify dataset selection flow`
- `test(utils): cover csv export edge cases`
- `docs(contributing): clarify review checklist`

Recommended types:

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `chore`

## Before You Request Review

- Run `npm test`.
- Run `npm run lint`.
- Check both light and dark mode for UI changes.
- Confirm icons come from `lucide-react`.
- Confirm animations use `framer-motion` appropriately.
- Keep shared state in Zustand only when it is actually shared.
- Update docs or shared types when your change affects developer-facing behavior.

## Questions

If you are unsure about scope or implementation direction, open a draft PR or start a discussion early. Early feedback is preferable to a large rewrite late in review.
