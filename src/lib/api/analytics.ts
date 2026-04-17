import { request } from "./client";
import type { ChurnResult, CohortResult, ABTestResult, ForecastResult } from "./types";

export async function churnPredict(
  data: Record<string, unknown>[],
  features: string[],
  target: string,
): Promise<ChurnResult> {
  return request<ChurnResult>("POST", "/api/v1/analytics/churn-predict", {
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
  return request<CohortResult>("POST", "/api/v1/analytics/cohort", {
    data,
    entity_id_column: userColumn,
    signup_date_column: dateColumn,
    activity_date_column: dateColumn,
    frequency,
  });
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
