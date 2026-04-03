# Contributing to DataLens

## Getting Started
1. Fork the repository
2. Clone: git clone https://github.com/YOUR_USERNAME/DataLens.git
3. Install: npm install
4. Run dev: npm run dev

## Development
- Frontend: Next.js 16, React 19, TypeScript strict
- Backend: cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
- Tests: npm test
- Lint: npm run lint
- Type check: npx tsc --noEmit

## Code Style
- TypeScript strict mode, no any
- Tailwind CSS v4 for styling
- Glass UI: bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45
- Components use React.ReactNode return type
- framer-motion for animations

## Testing
- Jest + React Testing Library for components
- pytest for backend
- Playwright for E2E

## Pull Requests
- Run npm test && npm run lint && npx tsc --noEmit before submitting
- Include test coverage for new components
- Follow existing patterns
