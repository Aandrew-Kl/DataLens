export interface RegressionResult {
  algorithm: string;
  row_count: number;
  metrics: {
    r2: number;
    rmse: number;
    cv_scores: number[];
    cv_mean: number;
    cv_std: number;
  };
  coefficients: Record<string, number>;
  intercept: number;
  residuals: number[];
  predictions: number[];
}

export interface ClusterResult {
  algorithm: string;
  row_count: number;
  labels: number[];
  silhouette_score: number | null;
  cluster_centers: Array<Record<string, number>>;
  cluster_sizes: Record<string, number>;
}

export interface ClassificationResult {
  algorithm: string;
  row_count: number;
  class_labels: string[];
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
  };
  confusion_matrix: number[][];
  classification_report: Record<string, unknown>;
  predictions: string[];
}

export interface AnomalyResult {
  algorithm: string;
  row_count: number;
  labels: number[];
  anomaly_scores: number[];
  anomaly_count: number;
}

export interface PCAResult {
  row_count: number;
  explained_variance_ratio: number[];
  loadings: Array<Record<string, unknown>>;
  transformed_data: number[][];
}

export interface SentimentItem {
  row_index: number;
  text: string;
  polarity: number;
  subjectivity: number;
  label: string;
}

export interface SentimentResult {
  text_column: string;
  row_count: number;
  aggregate: {
    mean_polarity: number;
    median_polarity: number;
    mean_subjectivity: number;
    positive_share: number;
    negative_share: number;
  };
  rows: SentimentItem[];
  top_terms: Array<{ term: string; score: number }>;
}

export interface SummarizeResult {
  dataset_id: number;
  summary_text: string;
  key_statistics: Record<string, unknown>;
  top_terms: { term: string; score: number }[];
}

export interface QueryGenerateResult {
  sql: string;
  explanation: string;
}

export interface ChurnResult {
  row_count: number;
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    roc_auc?: number;
  };
  risk_scores: number[];
  feature_importance: Record<string, number>;
  predictions: string[];
}

export interface CohortResult {
  total_users: number;
  cohort_count: number;
  retention_rows: Array<{
    cohort_period: string;
    period_index: number;
    cohort_size: number;
    retained_users: number;
    retention_rate: number;
  }>;
  summaries: Array<{
    cohort_period: string;
    cohort_size: number;
    max_period_index: number;
    first_period_retention: number | null;
  }>;
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

export type ApiFieldErrors = Record<string, string>;

function getApiErrorFieldKey(loc: unknown): string | undefined {
  if (!Array.isArray(loc) || loc.length === 0) {
    return undefined;
  }

  const path = loc
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map((part) => String(part));

  if (path.length === 0) {
    return undefined;
  }

  const bodyIndex = path.indexOf("body");
  const fieldPath = bodyIndex >= 0 ? path.slice(bodyIndex + 1) : path;

  if (fieldPath.length === 0) {
    return undefined;
  }

  return fieldPath.join(".");
}

export function getApiFieldErrors(body: unknown): ApiFieldErrors | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const detail = (body as Record<string, unknown>).detail;
  if (!Array.isArray(detail)) {
    return undefined;
  }

  const fieldErrors: ApiFieldErrors = {};

  for (const issue of detail) {
    if (!issue || typeof issue !== "object") {
      continue;
    }

    const record = issue as Record<string, unknown>;
    const field = getApiErrorFieldKey(record.loc);
    const message = typeof record.msg === "string" ? record.msg.trim() : "";

    if (!field || !message || fieldErrors[field]) {
      continue;
    }

    fieldErrors[field] = message;
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
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

  const fieldErrors = getApiFieldErrors(body);
  if (!fieldErrors) {
    return undefined;
  }

  return Object.values(fieldErrors)[0];
}

function getApiErrorMessage(body: unknown): string | undefined {
  const detail = getApiErrorDetail(body);
  if (detail) {
    return detail;
  }

  return undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly detail?: string;
  readonly fieldErrors?: ApiFieldErrors;

  constructor(status: number, message: string, body: unknown = null) {
    super(getApiErrorMessage(body) ?? message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.detail = getApiErrorDetail(body);
    this.fieldErrors = getApiFieldErrors(body);
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
