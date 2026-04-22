import {
  buildMetricExpression,
  quoteIdentifier,
  validateAggregation,
} from "@/lib/utils/sql";

describe("quoteIdentifier", () => {
  it("wraps plain identifiers in double-quotes", () => {
    expect(quoteIdentifier("sales")).toBe(`"sales"`);
  });

  it("escapes embedded double-quotes by doubling them", () => {
    expect(quoteIdentifier(`weird"name`)).toBe(`"weird""name"`);
  });

  it("preserves unusual characters without mangling them", () => {
    expect(quoteIdentifier("Order ID 2024")).toBe(`"Order ID 2024"`);
  });
});

describe("validateAggregation", () => {
  it("validates aggregations case-insensitively", () => {
    expect(validateAggregation(" sum ")).toBe("SUM");
    expect(validateAggregation("count_distinct")).toBe("COUNT_DISTINCT");
  });

  it("rejects unsupported aggregations", () => {
    expect(() => validateAggregation("medianish")).toThrow(
      "Invalid aggregation function: medianish",
    );
  });
});

describe("buildMetricExpression", () => {
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

  it("defaults to the built-in double-quote identifier quoter", () => {
    expect(buildMetricExpression("SUM", "sales")).toBe(
      `SUM(CAST("sales" AS DOUBLE))`,
    );
  });
});
