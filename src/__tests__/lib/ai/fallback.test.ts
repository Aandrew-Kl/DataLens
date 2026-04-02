import {
  generateFallbackSQL,
  generateFallbackQuestions,
  generateFallbackDashboard,
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

const columns = [numericCol, stringCol, dateCol];

describe("generateFallbackSQL", () => {
  it('handles "how many" queries', () => {
    const sql = generateFallbackSQL("How many rows?", "sales", columns);
    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain("sales");
  });

  it('handles "top N" queries', () => {
    const sql = generateFallbackSQL("Show top 10 records", "sales", columns);
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("DESC");
  });

  it('handles "average" queries', () => {
    const sql = generateFallbackSQL("What is the average revenue?", "sales", columns);
    expect(sql).toContain("AVG");
  });

  it('handles "sum" / "total" queries', () => {
    const sql = generateFallbackSQL("Show total revenue by region", "sales", columns);
    expect(sql).toContain("SUM");
    expect(sql).toContain("GROUP BY");
  });

  it('handles "trend" queries with date columns', () => {
    const sql = generateFallbackSQL("Show monthly trend of revenue", "sales", columns);
    expect(sql).toContain("DATE_TRUNC");
    expect(sql).toContain("month");
  });

  it('handles "show" / "preview" queries', () => {
    const sql = generateFallbackSQL("Show me the data", "sales", columns);
    expect(sql).toContain("SELECT *");
    expect(sql).toContain("LIMIT");
  });

  it("returns valid SQL for unknown queries", () => {
    const sql = generateFallbackSQL("something random", "sales", columns);
    expect(sql).toBeTruthy();
    expect(typeof sql).toBe("string");
  });

  it("quotes table and column names", () => {
    const sql = generateFallbackSQL("count", "my table", columns);
    expect(sql).toContain('"my table"');
  });
});

describe("generateFallbackQuestions", () => {
  it("returns an array of questions", () => {
    const questions = generateFallbackQuestions("sales", columns);
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(6);
  });

  it("includes relevant column names", () => {
    const questions = generateFallbackQuestions("sales", columns);
    const combined = questions.join(" ");
    expect(combined).toContain("revenue");
  });

  it("always includes total rows question", () => {
    const questions = generateFallbackQuestions("sales", columns);
    expect(questions[0]).toContain("rows");
  });

  it("handles columns with no numeric types", () => {
    const questions = generateFallbackQuestions("data", [stringCol]);
    expect(questions.length).toBeGreaterThan(0);
  });
});

describe("generateFallbackDashboard", () => {
  it("returns metrics and charts", () => {
    const dashboard = generateFallbackDashboard("sales", columns, 100);
    expect(dashboard.metrics).toBeDefined();
    expect(dashboard.charts).toBeDefined();
    expect(dashboard.metrics.length).toBeGreaterThan(0);
    expect(dashboard.charts.length).toBeGreaterThan(0);
  });

  it("includes row count metric", () => {
    const dashboard = generateFallbackDashboard("sales", columns, 100);
    expect(dashboard.metrics.some((m) => m.label === "Total Rows")).toBe(true);
  });

  it("generates bar chart for string x number", () => {
    const dashboard = generateFallbackDashboard("sales", columns, 100);
    expect(dashboard.charts.some((c) => c.type === "bar")).toBe(true);
  });

  it("generates line chart when date column exists", () => {
    const dashboard = generateFallbackDashboard("sales", columns, 100);
    expect(dashboard.charts.some((c) => c.type === "line")).toBe(true);
  });

  it("charts contain valid SQL", () => {
    const dashboard = generateFallbackDashboard("sales", columns, 100);
    dashboard.charts.forEach((chart) => {
      expect(chart.sql).toContain("SELECT");
      expect(chart.sql).toContain("sales");
    });
  });
});
