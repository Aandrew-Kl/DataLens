import {
  autoDashboardPrompt,
  chartRecommendationPrompt,
  sqlGenerationPrompt,
  suggestQuestionsPrompt,
  summaryPrompt,
} from "@/lib/ai/prompts";
import type { ColumnProfile } from "@/types/dataset";

const numericCol: ColumnProfile = {
  name: "revenue_total",
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
  name: "customer_region",
  type: "string",
  nullCount: 3,
  uniqueCount: 8,
  sampleValues: ["EMEA", "APAC", "AMER"],
};

const dateCol: ColumnProfile = {
  name: "order_date",
  type: "date",
  nullCount: 0,
  uniqueCount: 365,
  sampleValues: ["2024-01-01", "2024-06-15"],
  min: "2024-01-01",
  max: "2024-12-31",
};

const columns: ColumnProfile[] = [numericCol, stringCol, dateCol];

describe("sqlGenerationPrompt", () => {
  it("returns a non-empty system/user pair", () => {
    const messages = sqlGenerationPrompt("Show all data", "sales 2024", columns);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    messages.forEach((message) => {
      expect(message.content).toBeTruthy();
    });
  });

  it("includes table name, schema and SQL rules", () => {
    const messages = sqlGenerationPrompt("What is the average revenue?", "Sales 2024", columns);
    const systemContent = messages[0].content;

    expect(systemContent).toContain('TABLE: "Sales 2024"');
    expect(systemContent).toContain('"revenue_total"');
    expect(systemContent).toContain("number");
    expect(systemContent).toContain("Return ONLY the SQL query");
    expect(systemContent).toContain("DuckDB SQL dialect");
    expect(systemContent).toContain('LIMIT results to 1000 rows max');
  });

  it("uses the raw user prompt in the user message", () => {
    const question = "How many rows are in the dataset?";
    const messages = sqlGenerationPrompt(question, "orders", columns);
    expect(messages[1].content).toBe(question);
  });
});

describe("chartRecommendationPrompt", () => {
  const sampleData = [
    { category: "A", total: 120 },
    { category: "B", total: 95 },
    { category: "C", total: 77 },
    { category: "D", total: 66 },
  ];

  it("returns a non-empty system/user pair with required JSON guidance", () => {
    const messages = chartRecommendationPrompt(
      'SELECT category, total FROM "sales" LIMIT 100',
      ["category", "total"],
      sampleData,
      123,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("Return ONLY a JSON object");
    expect(messages[0].content).toContain('"type":"bar|line|pie|scatter|histogram|area"');
    expect(messages[1].content).toContain("SQL: SELECT");
    expect(messages[1].content).toContain("Row count: 123");
    expect(messages[1].content).toContain("category, total");
  });

  it("limits sample rows to the first three rows", () => {
    const messages = chartRecommendationPrompt(
      "SELECT * FROM sales",
      ["category", "total"],
      sampleData,
      123,
    );

    const userContent = messages[1].content;
    expect(userContent).toContain('"category":"A","total":120');
    expect(userContent).toContain('"category":"C","total":77');
    expect(userContent).not.toContain('"category":"D","total":66');
  });
});

describe("autoDashboardPrompt", () => {
  it("returns a non-empty prompt containing both metric and chart instructions", () => {
    const messages = autoDashboardPrompt("sales", columns, 5000);

    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.content.length > 0)).toBe(true);
    expect(messages[1].content).toContain("Table: \"sales\" (5000 rows)");

    const systemContent = messages[0].content;
    expect(systemContent).toContain("metrics");
    expect(systemContent).toContain("charts");
    expect(systemContent).toContain('"type":"bar|line|pie|scatter|histogram|area"');
    expect(systemContent).toContain("Return ONLY a JSON object");
  });
});

describe("summaryPrompt", () => {
  it("returns a concise non-empty two-message prompt", () => {
    const messages = summaryPrompt("What are the top categories?", [{ cat: "A" }, { cat: "B" }], 2);

    expect(messages).toHaveLength(2);
    messages.forEach((message) => {
      expect(message.content).toBeTruthy();
    });
    expect(messages[0].content).toContain("1-2 sentence summary");
    expect(messages[1].content).toContain('Question: "What are the top categories?"');
  });

  it("includes requested row limit and row count", () => {
    const data = Array.from({ length: 30 }, (_, index) => ({ id: index }));
    const messages = summaryPrompt("Top 10 by revenue", data, 30);

    const userContent = messages[1].content;
    expect(userContent).toContain("Total rows: 30");
    expect(userContent).toContain('"id":19');
    expect(userContent).not.toContain('"id":20');
  });
});

describe("suggestQuestionsPrompt", () => {
  it("returns a valid non-empty system/user pair", () => {
    const messages = suggestQuestionsPrompt("transactions", columns, 1000);

    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.content.length > 0)).toBe(true);
    expect(messages[0].content).toContain("JSON array of strings");
    expect(messages[1].content).toContain('Table: "transactions" (1000 rows)');
    expect(messages[1].content).toContain("customer_region");
  });

  it("propagates the question context from schema metadata", () => {
    const messages = suggestQuestionsPrompt("transactions", columns, 1000);
    expect(messages[0].content).toContain("Mix simple");
    expect(messages[0].content).toContain("Make questions specific and actionable");
  });
});
