export interface RegressionResult {
  r2: number;
  rmse: number;
  coefficients: Record<string, number>;
  intercept: number;
  method: string;
}

export interface ClusterResult {
  labels: number[];
  centers: number[][];
  silhouette_score: number;
  method: string;
}

export interface ClassificationResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  confusion_matrix: number[][];
  feature_importance: Record<string, number>;
}

export interface AnomalyResult {
  labels: number[];
  scores: number[];
}

export interface PCAResult {
  explained_variance: number[];
  loadings: number[][];
  transformed: number[][];
}

export interface SentimentItem {
  text: string;
  polarity: number;
  subjectivity: number;
  label: string;
}

export interface SentimentResult {
  results: SentimentItem[];
  avg_polarity: number;
  avg_subjectivity: number;
}

export interface SummarizeResult {
  summary: string;
  top_terms: { term: string; score: number }[];
  stats: Record<string, Record<string, number>>;
}

export interface QueryGenerateResult {
  sql: string;
  explanation: string;
}

export interface ChurnResult {
  risk_scores: number[];
  feature_importance: Record<string, number>;
  accuracy: number;
}

export interface CohortResult {
  cohorts: Record<string, Record<string, number>>;
}

export interface ABTestResult {
  p_value: number;
  confidence_interval: [number, number];
  effect_size: number;
  significant: boolean;
}

export interface ForecastResult {
  predictions: { date: string; value: number }[];
  model: string;
}

function getApiErrorDetail(body: unknown): string | undefined {
  if (typeof body === "string" && body.trim()) {
    return body;
  }

  if (!body || typeof body !== "object") {
    return undefined;
  }

  const candidate = body as Record<string, unknown>;

  for (const key of ["detail", "message", "error"]) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly detail?: string;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.detail = getApiErrorDetail(body);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AuthToken {
  access_token: string;
  token_type: string;
}

export interface UserInfo {
  id: string;
  email: string;
  created_at: string;
}

export interface RegisterResponse extends AuthToken, UserInfo {
  user: UserInfo;
}

export interface DatasetInfo {
  id: string;
  name: string;
  row_count: number;
  column_count: number;
  created_at: string;
}
