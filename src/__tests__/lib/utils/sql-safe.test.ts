import {
  buildMetricExpression,
  validateAggregation,
} from "@/lib/utils/sql-safe";

describe("sql-safe", () => {
  it("validates aggregations case-insensitively", () => {
    expect(validateAggregation(" sum ")).toBe("SUM");
    expect(validateAggregation("count_distinct")).toBe("COUNT_DISTINCT");
  });

  it("rejects unsupported aggregations", () => {
    expect(() => validateAggregation("medianish")).toThrow(
      "Invalid aggregation function: medianish",
    );
  });

  it("returns COUNT(*) for count aggregations or when no column is provided", () => {
    expect(buildMetricExpression("COUNT", "sales")).toBe("COUNT(*)");
    expect(buildMetricExpression("SUM")).toBe("COUNT(*)");
  });

  it("supports distinct, preserveCase, and cast-free metric expressions", () => {
    expect(
      buildMetricExpression("COUNT_DISTINCT", "Order ID", (value) => `[${value}]`),
    ).toBe("COUNT(DISTINCT [Order ID])");

    expect(
      buildMetricExpression("avg", "net total", (value) => `[${value}]`, {
        cast: false,
        preserveCase: true,
      }),
    ).toBe("avg([net total])");
  });
});
