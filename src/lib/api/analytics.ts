import { request } from "./client";
import type { ChurnResult, CohortResult, ABTestResult, ForecastResult } from "./types";

export async function churnPredict(
  data: Record<string, unknown>[],
  features: string[],
  target: string,
): Promise<ChurnResult> {
  return request<ChurnResult>("POST", "/api/v1/analytics/churn-predict", { data, features, target });
}

export async function cohortAnalysis(
  data: Record<string, unknown>[],
  date_column: string,
  user_column: string,
): Promise<CohortResult> {
  return request<CohortResult>("POST", "/api/v1/analytics/cohort", { data, date_column, user_column });
}

export async function abTest(
  control: number[],
  treatment: number[],
): Promise<ABTestResult> {
  return request<ABTestResult>("POST", "/api/v1/analytics/ab-test", { control, treatment });
}

export async function forecast(
  data: Record<string, unknown>[],
  date_column: string,
  value_column: string,
  periods: number = 12,
): Promise<ForecastResult> {
  return request<ForecastResult>("POST", "/api/v1/analytics/forecast", { data, date_column, value_column, periods });
}
