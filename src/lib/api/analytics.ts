import { request } from "./client";
import type { ChurnResult, CohortResult, ABTestResult, ForecastResult } from "./types";

export async function churnPredict(
  data: Record<string, unknown>[],
  features: string[],
  target: string,
): Promise<ChurnResult> {
  return request<ChurnResult>("POST", "/api/analytics/churn-predict", {
    data,
    feature_columns: features,
    target_column: target,
  });
}

export async function cohortAnalysis(
  data: Record<string, unknown>[],
  dateColumn: string,
  userColumn: string,
  frequency: "weekly" | "monthly" = "monthly",
): Promise<CohortResult> {
  return request<CohortResult>("POST", "/api/analytics/cohort", {
    data,
    entity_id_column: userColumn,
    signup_date_column: dateColumn,
    activity_date_column: dateColumn,
    frequency,
  });
}

export async function abTest(
  data: Record<string, unknown>[],
  group_column: string,
  metric_column: string,
  variant_a: string,
  variant_b: string,
): Promise<ABTestResult> {
  return request<ABTestResult>("POST", "/api/analytics/ab-test", {
    data,
    group_column,
    metric_column,
    variant_a,
    variant_b,
  });
}

export async function forecast(
  data: Record<string, unknown>[],
  date_col: string,
  value_col: string,
  periods: number = 12,
  method?: string,
): Promise<ForecastResult> {
  return request<ForecastResult>("POST", "/api/analytics/forecast", {
    data,
    date_col,
    value_col,
    periods,
    ...(method ? { method } : {}),
  });
}
