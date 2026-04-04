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
      path: "/api/v1/analytics/churn-predict",
      payload: {
        data,
        features: ["retained", "revenue"],
        target: "retained",
      },
      response: {
        risk_scores: [0.12, 0.88],
        feature_importance: { revenue: 0.7, retained: 0.3 },
        accuracy: 0.89,
      },
    },
    {
      name: "cohortAnalysis",
      invoke: () => cohortAnalysis(data, "signup_date", "user_id"),
      path: "/api/v1/analytics/cohort",
      payload: {
        data,
        date_column: "signup_date",
        user_column: "user_id",
      },
      response: {
        cohorts: {
          "2026-01": { "0": 2, "1": 1 },
        },
      },
    },
    {
      name: "abTest",
      invoke: () => abTest([1.2, 1.5, 1.7], [1.8, 2.1, 2.3]),
      path: "/api/v1/analytics/ab-test",
      payload: {
        control: [1.2, 1.5, 1.7],
        treatment: [1.8, 2.1, 2.3],
      },
      response: {
        p_value: 0.03,
        confidence_interval: [0.1, 0.6] as [number, number],
        effect_size: 0.4,
        significant: true,
      },
    },
    {
      name: "forecast",
      invoke: () => forecast(data, "signup_date", "revenue", 6),
      path: "/api/v1/analytics/forecast",
      payload: {
        data,
        date_column: "signup_date",
        value_column: "revenue",
        periods: 6,
      },
      response: {
        predictions: [
          { date: "2026-02-01", value: 110 },
          { date: "2026-03-01", value: 115 },
        ],
        model: "arima",
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
