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

export interface ApiError {
  status: number;
  message: string;
  detail?: string;
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

export interface DatasetInfo {
  id: string;
  name: string;
  row_count: number;
  column_count: number;
  created_at: string;
}
