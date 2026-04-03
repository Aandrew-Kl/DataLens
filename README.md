# DataLens — AI-Powered Data Explorer

An open-source, AI-powered data exploration platform built with Next.js 16, React 19, and Python FastAPI.

## Features
- **Data Import**: CSV, JSON, XLSX upload with auto-profiling
- **SQL Editor**: Full SQL support via DuckDB WASM (in-browser)
- **Interactive Charts**: 42+ chart types powered by ECharts
- **Machine Learning**: Real scikit-learn models (regression, clustering, classification, anomaly detection, PCA)
- **AI Features**: Sentiment analysis, NL-to-SQL, data summarization
- **Analytics**: A/B testing, cohort analysis, churn prediction, forecasting
- **Real-time**: WebSocket streaming for live data
- **293+ Components**: Data tools, ML views, analytics dashboards
- **Dark Mode**: Glass UI design with Tailwind CSS v4

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS v4, Glass UI |
| Charts | ECharts 6, echarts-for-react |
| State | Zustand |
| Client DB | DuckDB WASM |
| Backend | Python FastAPI |
| ML/AI | scikit-learn, TextBlob, scipy, statsmodels |
| Database | PostgreSQL (async via SQLAlchemy 2) |
| Auth | JWT (python-jose + bcrypt) |
| Testing | Jest + RTL (frontend), pytest (backend) |
| Deployment | Docker + docker-compose |

## Quick Start

### Frontend only (no backend required)
```bash
npm install
npm run dev
# Open http://localhost:3000
```

### Full stack (with Python backend)
```bash
# Terminal 1: Frontend
npm install
npm run dev

# Terminal 2: Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Or with Docker
cd backend
docker-compose up -d
```

### Environment Variables
Create `.env` in `/backend/`:
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/datalens
JWT_SECRET=your-secret-key
OLLAMA_URL=http://localhost:11434
```

## Project Structure
```
datalens/
├── src/                    # Next.js frontend
│   ├── app/               # App Router pages
│   ├── components/        # 293+ React components
│   │   ├── charts/        # 42 chart types
│   │   ├── data/          # Data tools
│   │   ├── ml/            # ML model views
│   │   ├── analytics/     # Analytics dashboards
│   │   ├── ai/            # AI features
│   │   ├── query/         # SQL tools
│   │   ├── report/        # Report builder
│   │   ├── auth/          # Authentication
│   │   ├── settings/      # App settings
│   │   └── layout/        # Layout components
│   ├── lib/               # Utilities
│   │   ├── api/           # Backend API client
│   │   └── duckdb/        # DuckDB WASM client
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # Zustand state
│   └── types/             # TypeScript types
├── backend/               # Python FastAPI
│   ├── app/
│   │   ├── api/           # REST + WebSocket endpoints
│   │   ├── models/        # SQLAlchemy models
│   │   ├── schemas/       # Pydantic schemas
│   │   └── services/      # ML, NLP, analytics
│   └── tests/             # pytest tests
└── e2e/                   # Playwright E2E tests
```

## API Endpoints

### Auth
- `POST /api/v1/auth/register` — Create account
- `POST /api/v1/auth/login` — Get JWT token
- `GET /api/v1/auth/me` — Current user

### Machine Learning
- `POST /api/v1/ml/regression` — Linear/Ridge/Lasso regression
- `POST /api/v1/ml/cluster` — KMeans/DBSCAN clustering
- `POST /api/v1/ml/classify` — RandomForest/GBM/SVM classification
- `POST /api/v1/ml/anomaly-detect` — Isolation Forest/LOF
- `POST /api/v1/ml/pca` — PCA dimensionality reduction

### AI
- `POST /api/v1/ai/sentiment` — TextBlob sentiment analysis
- `POST /api/v1/ai/summarize` — TF-IDF data summarization
- `POST /api/v1/ai/generate-query` — Natural language to SQL

### Analytics
- `POST /api/v1/analytics/churn-predict` — Churn prediction (GBM)
- `POST /api/v1/analytics/cohort` — Cohort retention analysis
- `POST /api/v1/analytics/ab-test` — A/B test significance (t-test)
- `POST /api/v1/analytics/forecast` — Time series forecasting

## Testing
```bash
# Frontend tests (330 suites, 1345+ tests)
npm test

# Backend tests
cd backend && pytest

# E2E tests
npx playwright test
```

## License
MIT
