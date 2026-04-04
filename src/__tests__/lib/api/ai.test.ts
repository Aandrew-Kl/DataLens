import { request } from "@/lib/api/client";
import { generateQuery, sentiment, summarize } from "@/lib/api/ai";

jest.mock("@/lib/api/client", () => ({
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);

describe("ai API", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  test.each([
    {
      name: "sentiment",
      invoke: () => sentiment(["The dashboard is excellent", "The export failed"]),
      path: "/api/v1/ai/sentiment",
      payload: {
        texts: ["The dashboard is excellent", "The export failed"],
      },
      response: {
        results: [
          { text: "The dashboard is excellent", polarity: 0.8, subjectivity: 0.4, label: "positive" },
          { text: "The export failed", polarity: -0.7, subjectivity: 0.6, label: "negative" },
        ],
        avg_polarity: 0.05,
        avg_subjectivity: 0.5,
      },
    },
    {
      name: "summarize",
      invoke: () => summarize([{ region: "EMEA", revenue: 120 }], ["region", "revenue"]),
      path: "/api/v1/ai/summarize",
      payload: {
        data: [{ region: "EMEA", revenue: 120 }],
        columns: ["region", "revenue"],
      },
      response: {
        summary: "Revenue is concentrated in EMEA.",
        top_terms: [{ term: "EMEA", score: 0.93 }],
        stats: { revenue: { mean: 120, min: 120, max: 120 } },
      },
    },
    {
      name: "generateQuery",
      invoke: () =>
        generateQuery("Show revenue by region", "sales", [
          { name: "region", type: "text" },
          { name: "revenue", type: "number" },
        ]),
      path: "/api/v1/ai/generate-query",
      payload: {
        question: "Show revenue by region",
        table_name: "sales",
        columns: [
          { name: "region", type: "text" },
          { name: "revenue", type: "number" },
        ],
      },
      response: {
        sql: "SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region",
        explanation: "Aggregates revenue by region.",
      },
    },
  ])("calls $name with the correct payload and returns the regular response", async ({
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
