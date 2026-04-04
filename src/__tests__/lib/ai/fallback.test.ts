import {
  generateFallbackDashboard,
  generateFallbackQuestions,
  generateFallbackSQL,
} from "@/lib/ai/fallback";
import type { ColumnProfile } from "@/types/dataset";

const numericCol: ColumnProfile = {
  name: "revenue",
  type: "number",
  nullCount: 0,
  uniqueCount: 50,
  sampleValues: [100, 200, 300],
  min: 10,
  max: 5000,
  mean: 250,
  median: 200,
};

const stringCol: ColumnProfile = {
  name: "region",
  type: "string",
  nullCount: 2,
  uniqueCount: 5,
  sampleValues: ["North", "South", "East"],
};

const dateCol: ColumnProfile = {
  name: "order_date",
  type: "date",
  nullCount: 0,
  uniqueCount: 30,
  sampleValues: ["2024-01-01", "2024-02-01"],
  min: "2024-01-01",
  max: "2024-12-31",
};

const numericOnlyColumns: ColumnProfile[] = [
  {
    ...numericCol,
    name: "amount",
    mean: 42,
  },
];

const stringOnlyColumns: ColumnProfile[] = [
  {
    ...stringCol,
    name: "category",
  },
];

const columns: ColumnProfile[] = [numericCol, stringCol, dateCol];

describe("generateFallbackSQL", () => {
  it("handles count and preview style queries", () => {
    expect(generateFallbackSQL("How many rows exist?", "sales_data", columns)).toContain(
      'SELECT COUNT(*) AS total_count FROM "sales_data"',
    );
    expect(generateFallbackSQL("show first rows", "sales_data", columns)).toContain(
      'SELECT * FROM "sales_data" LIMIT 20',
    );
  });

  it("handles top N and average with numeric columns", () => {
    expect(generateFallbackSQL("Show top 7", "sales_data", columns)).toContain(
      "ORDER BY \"revenue\" DESC LIMIT 7",
    );
    expect(generateFallbackSQL("average revenue", "sales_data", columns)).toContain(
      'AVG("revenue") AS avg_revenue',
    );
  });

  it("handles date trends and grouping", () => {
    expect(generateFallbackSQL("monthly trend", "sales_data", columns)).toContain(
      "DATE_TRUNC('month', \"order_date\"::DATE) AS month",
    );
    expect(generateFallbackSQL("distribution by region", "sales_data", columns)).toContain(
      'GROUP BY "region"',
    );
    expect(generateFallbackSQL("show unique regions", "sales_data", columns)).toContain(
      'GROUP BY "region"',
    );
  });

  it("quotes table names with spaces", () => {
    const sql = generateFallbackSQL("how many", "sales data", columns);
    expect(sql).toContain('"sales data"');
  });

  it("returns a SQL string for unknown question patterns", () => {
    const sql = generateFallbackSQL("something unexpected", "sales", columns);
    expect(sql).toContain("SELECT");
    expect(sql).toContain('FROM "sales"');
  });
});

describe("generateFallbackQuestions", () => {
  it("returns an array of non-empty strings", () => {
    const questions = generateFallbackQuestions("sales", columns);

    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => typeof question === "string" && question.length > 0)).toBe(true);
  });

  it("uses column metadata to create relevant suggestions", () => {
    const questions = generateFallbackQuestions("sales", columns);
    const joined = questions.join(" | ");

    expect(joined).toContain("revenue");
    expect(joined).toContain("region");
    expect(joined[0]).toBeDefined();
    expect(joined).toContain("total rows");
  });

  it("still returns questions without numeric columns", () => {
    const questions = generateFallbackQuestions("products", stringOnlyColumns);

    expect(questions).toEqual([
      "How many total rows are in the dataset?",
      "What are the unique values of category?",
    ]);
  });

  it("caps the number of questions at six", () => {
    const questions = generateFallbackQuestions("sales", [
      numericCol,
      stringCol,
      dateCol,
      numericCol,
      stringCol,
      dateCol,
    ]);

    expect(questions.length).toBeLessThanOrEqual(6);
  });
});

describe("generateFallbackDashboard", () => {
  it("returns metrics and charts for mixed column types", () => {
    const dashboard = generateFallbackDashboard("sales", columns, 120);

    expect(dashboard).toEqual(
      expect.objectContaining({
        metrics: expect.any(Array),
        charts: expect.any(Array),
      }),
    );
    expect(dashboard.metrics.length).toBeGreaterThanOrEqual(2);
    expect(dashboard.charts.length).toBeGreaterThan(0);

    const metricLabels = dashboard.metrics.map((metric) => metric.label);
    expect(metricLabels).toContain("Total Rows");
    expect(metricLabels).toContain("Columns");
  });

  it("produces chart SQL that references quoted identifiers", () => {
    const dashboard = generateFallbackDashboard("sales table", columns, 120);

    dashboard.charts.forEach((chart) => {
      expect(chart.id).toMatch(/^chart-/);
      expect(chart.title).toBeTruthy();
      expect(chart.sql).toContain('FROM "sales table"');
      expect(chart.sql).toMatch(/^SELECT /);
    });
  });

  it("returns only metrics when there are no string columns", () => {
    const dashboard = generateFallbackDashboard("numbers_only", numericOnlyColumns, 50);

    expect(dashboard.metrics.length).toBeGreaterThan(0);
    expect(dashboard.charts).toHaveLength(0);
    expect(dashboard.metrics[0].label).toBe("Total Rows");
    expect(dashboard.metrics[1].label).toBe("Columns");
  });

  it("returns a limited dashboard for string-only schema", () => {
    const dashboard = generateFallbackDashboard("strings", stringOnlyColumns, 50);

    expect(dashboard.metrics.length).toBe(2);
    expect(dashboard.charts).toHaveLength(1);
    expect(dashboard.charts[0]).toMatchObject({ type: "pie", xAxis: "category", yAxis: "count" });
    expect(dashboard.charts[0].sql).toContain("COUNT(*) AS count");
  });
});
