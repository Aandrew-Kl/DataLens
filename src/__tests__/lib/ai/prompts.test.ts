import {
  sqlGenerationPrompt,
  chartRecommendationPrompt,
  autoDashboardPrompt,
  summaryPrompt,
  suggestQuestionsPrompt,
} from "@/lib/ai/prompts";
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
  name: "category",
  type: "string",
  nullCount: 3,
  uniqueCount: 8,
  sampleValues: ["Electronics", "Clothing", "Food"],
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
  it("returns system and user messages", () => {
    const messages = sqlGenerationPrompt("Show all data", "sales", columns);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("includes the table name in system message", () => {
    const messages = sqlGenerationPrompt("Show all data", "orders", columns);
    expect(messages[0].content).toContain('"orders"');
  });

  it("includes column names in system message", () => {
    const messages = sqlGenerationPrompt("Show all data", "sales", columns);
    const systemContent = messages[0].content;
    expect(systemContent).toContain("revenue");
    expect(systemContent).toContain("category");
    expect(systemContent).toContain("order_date");
  });

  it("includes column types in schema", () => {
    const messages = sqlGenerationPrompt("test", "sales", columns);
    const systemContent = messages[0].content;
    expect(systemContent).toContain("number");
    expect(systemContent).toContain("string");
    expect(systemContent).toContain("date");
  });

  it("includes numeric range for numeric columns", () => {
    const messages = sqlGenerationPrompt("test", "sales", columns);
    const systemContent = messages[0].content;
    expect(systemContent).toContain("range: 10 to 5000");
  });

  it("includes mean for numeric columns", () => {
    const messages = sqlGenerationPrompt("test", "sales", columns);
    const systemContent = messages[0].content;
    expect(systemContent).toContain("mean: 250");
  });

  it("includes unique count and null count", () => {
    const messages = sqlGenerationPrompt("test", "sales", columns);
    const systemContent = messages[0].content;
    expect(systemContent).toContain("50 unique values");
    expect(systemContent).toContain("3 nulls");
  });

  it("passes the user question as the user message", () => {
    const question = "What is the total revenue by category?";
    const messages = sqlGenerationPrompt(question, "sales", columns);
    expect(messages[1].content).toBe(question);
  });

  it("mentions DuckDB dialect in instructions", () => {
    const messages = sqlGenerationPrompt("test", "t", columns);
    expect(messages[0].content).toContain("DuckDB");
  });
});

describe("chartRecommendationPrompt", () => {
  const sampleData = [
    { category: "A", total: 100 },
    { category: "B", total: 200 },
  ];

  it("returns system and user messages", () => {
    const messages = chartRecommendationPrompt(
      "SELECT category, SUM(revenue) FROM sales GROUP BY category",
      ["category", "total"],
      sampleData,
      10
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("includes the SQL in user message", () => {
    const sql = "SELECT category, SUM(revenue) FROM sales GROUP BY category";
    const messages = chartRecommendationPrompt(sql, ["category", "total"], sampleData, 10);
    expect(messages[1].content).toContain(sql);
  });

  it("includes column names in user message", () => {
    const messages = chartRecommendationPrompt(
      "SELECT *",
      ["category", "total"],
      sampleData,
      5
    );
    expect(messages[1].content).toContain("category");
    expect(messages[1].content).toContain("total");
  });

  it("includes row count in user message", () => {
    const messages = chartRecommendationPrompt("SELECT *", ["a"], sampleData, 42);
    expect(messages[1].content).toContain("42");
  });

  it("includes sample data limited to 3 rows", () => {
    const bigSample = [
      { x: 1 },
      { x: 2 },
      { x: 3 },
      { x: 4 },
      { x: 5 },
    ];
    const messages = chartRecommendationPrompt("SELECT *", ["x"], bigSample, 100);
    const parsed = messages[1].content;
    // Only first 3 should appear in the stringified sample
    expect(parsed).toContain('"x":1');
    expect(parsed).toContain('"x":2');
    expect(parsed).toContain('"x":3');
    expect(parsed).not.toContain('"x":4');
  });
});

describe("autoDashboardPrompt", () => {
  it("returns system and user messages", () => {
    const messages = autoDashboardPrompt("sales", columns, 1000);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("includes table name in both messages", () => {
    const messages = autoDashboardPrompt("products", columns, 500);
    expect(messages[0].content).toContain("products");
    expect(messages[1].content).toContain("products");
  });

  it("includes row count in user message", () => {
    const messages = autoDashboardPrompt("sales", columns, 7500);
    expect(messages[1].content).toContain("7500");
  });

  it("includes column schema in user message", () => {
    const messages = autoDashboardPrompt("sales", columns, 100);
    const userContent = messages[1].content;
    expect(userContent).toContain("revenue");
    expect(userContent).toContain("category");
    expect(userContent).toContain("order_date");
  });
});

describe("summaryPrompt", () => {
  const data = [
    { category: "A", total: 100 },
    { category: "B", total: 200 },
  ];

  it("returns system and user messages", () => {
    const messages = summaryPrompt("What are the totals?", data, 2);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("includes the question in user message", () => {
    const question = "What is the average revenue?";
    const messages = summaryPrompt(question, data, 2);
    expect(messages[1].content).toContain(question);
  });

  it("includes total row count in user message", () => {
    const messages = summaryPrompt("test", data, 150);
    expect(messages[1].content).toContain("150");
  });

  it("limits data to first 20 rows", () => {
    const bigData = Array.from({ length: 30 }, (_, i) => ({ id: i }));
    const messages = summaryPrompt("test", bigData, 30);
    const content = messages[1].content;
    expect(content).toContain('"id":19');
    expect(content).not.toContain('"id":20');
  });
});

describe("suggestQuestionsPrompt", () => {
  it("returns system and user messages", () => {
    const messages = suggestQuestionsPrompt("sales", columns, 1000);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("includes table name and row count in user message", () => {
    const messages = suggestQuestionsPrompt("inventory", columns, 2500);
    expect(messages[1].content).toContain("inventory");
    expect(messages[1].content).toContain("2500");
  });

  it("includes column schema in user message", () => {
    const messages = suggestQuestionsPrompt("sales", columns, 100);
    const userContent = messages[1].content;
    expect(userContent).toContain("revenue");
    expect(userContent).toContain("number");
    expect(userContent).toContain("order_date");
  });
});
