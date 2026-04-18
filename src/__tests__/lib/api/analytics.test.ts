import { request } from "@/lib/api/client";
import { abTest, cohortAnalysis, churnPredict, forecast } from "@/lib/api/analytics";

jest.mock("@/lib/api/client", () => ({
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);

describe("analytics API", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  const data = [
    { user_id: "u1", signup_date: "2026-01-01", retained: true, revenue: 100 },
    { user_id: "u2", signup_date: "2026-01-08", retained: false, revenue: 90 },
  ];

  test.each([
    {
      name: "churnPredict",
      invoke: () => churnPredict(data, ["retained", "revenue"], "retained"),
      path: "/api/analytics/churn-predict",
      payload: {
        data,
        feature_columns: ["retained", "revenue"],
        target_column: "retained",
      },
      response: {
        row_count: 2,
        metrics: {
          accuracy: 0.89,
          precision: 0.86,
          recall: 0.9,
          f1: 0.88,
        },
        risk_scores: [12, 88],
        feature_importance: { revenue: 0.7, retained: 0.3 },
        predictions: ["false", "true"],
      },
    },
    {
      name: "cohortAnalysis",
      invoke: () => cohortAnalysis(data, "signup_date", "user_id"),
      path: "/api/analytics/cohort",
      payload: {
        data,
        entity_id_column: "user_id",
        signup_date_column: "signup_date",
        activity_date_column: "signup_date",
        frequency: "monthly",
      },
      response: {
        total_users: 2,
        cohort_count: 1,
        retention_rows: [
          {
            cohort_period: "2026-01",
            period_index: 0,
            cohort_size: 2,
            retained_users: 2,
            retention_rate: 100,
          },
          {
            cohort_period: "2026-01",
            period_index: 1,
            cohort_size: 2,
            retained_users: 1,
            retention_rate: 50,
          },
        ],
        summaries: [
          {
            cohort_period: "2026-01",
            cohort_size: 2,
            max_period_index: 1,
            first_period_retention: 50,
          },
        ],
      },
    },
    {
      name: "abTest",
      invoke: () =>
        abTest(
          [
            { experiment_group: "control", conversion_rate: 1.2 },
            { experiment_group: "control", conversion_rate: 1.5 },
            { experiment_group: "treatment", conversion_rate: 1.8 },
            { experiment_group: "treatment", conversion_rate: 2.1 },
          ],
          "experiment_group",
          "conversion_rate",
          "control",
          "treatment",
        ),
      path: "/api/analytics/ab-test",
      payload: {
        data: [
          { experiment_group: "control", conversion_rate: 1.2 },
          { experiment_group: "control", conversion_rate: 1.5 },
          { experiment_group: "treatment", conversion_rate: 1.8 },
          { experiment_group: "treatment", conversion_rate: 2.1 },
        ],
        group_column: "experiment_group",
        metric_column: "conversion_rate",
        variant_a: "control",
        variant_b: "treatment",
      },
      response: {
        test_used: "ttest_ind",
        p_value: 0.03,
        statistic: 2.31,
        confidence_interval: [0.1, 0.6] as [number, number],
        effect_size: 0.4,
        significant: true,
        summary: {
          variant_a_count: 2,
          variant_b_count: 2,
          variant_a_mean: 1.35,
          variant_b_mean: 1.95,
          uplift: 0.6,
        },
      },
    },
    {
      name: "forecast",
      invoke: () => forecast(data, "signup_date", "revenue", 6),
      path: "/api/analytics/forecast",
      payload: {
        data,
        date_col: "signup_date",
        value_col: "revenue",
        periods: 6,
      },
      response: {
        method: "holt_winters",
        history_points: 12,
        forecast_points: [
          { date: "2026-02-01T00:00:00", forecast: 110, lower: 100, upper: 120 },
          { date: "2026-03-01T00:00:00", forecast: 115, lower: 104, upper: 126 },
        ],
        metrics: {
          rmse: 4.2,
          mae: 3.6,
          mape: 8.9,
          last_actual: 101,
          last_fitted: 99,
        },
      },
    },
  ])("calls $name with the correct payload and returns the response", async ({
    invoke,
    path,
    payload,
    response,
  }) => {
    mockedRequest.mockResolvedValue(response);

    await expect(invoke()).resolves.toEqual(response);

    expect(mockedRequest).toHaveBeenCalledWith("POST", path, payload);
  });
});
