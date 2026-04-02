import { generateSQL, recommendChart, generateSummary } from "@/lib/ai/sql-generator";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/ai/ollama-client", () => ({
  chat: jest.fn(),
}));

import { chat } from "@/lib/ai/ollama-client";
const mockChat = chat as jest.MockedFunction<typeof chat>;

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
  nullCount: 0,
  uniqueCount: 5,
  sampleValues: ["North", "South", "East"],
};

const columns: ColumnProfile[] = [numericCol, stringCol];

beforeEach(() => {
  mockChat.mockReset();
});

describe("generateSQL", () => {
  it("returns cleaned SQL from the AI response", async () => {
    mockChat.mockResolvedValue('SELECT * FROM "sales" LIMIT 10');
    const sql = await generateSQL("Show all data", "sales", columns);
    expect(sql).toBe('SELECT * FROM "sales" LIMIT 10');
  });

  it("strips markdown code fences from response", async () => {
    mockChat.mockResolvedValue('```sql\nSELECT COUNT(*) FROM "sales"\n```');
    const sql = await generateSQL("How many rows?", "sales", columns);
    expect(sql).toBe('SELECT COUNT(*) FROM "sales"');
    expect(sql).not.toContain("```");
  });

  it("strips code fences without language tag", async () => {
    mockChat.mockResolvedValue('```\nSELECT 1\n```');
    const sql = await generateSQL("test", "t", columns);
    expect(sql).toBe("SELECT 1");
  });

  it("extracts SELECT statement from noisy response", async () => {
    mockChat.mockResolvedValue(
      'Here is your query:\nSELECT "revenue" FROM "sales" ORDER BY "revenue" DESC LIMIT 5'
    );
    const sql = await generateSQL("top 5 revenue", "sales", columns);
    expect(sql).toContain("SELECT");
    expect(sql).toContain("revenue");
  });

  it("trims whitespace from response", async () => {
    mockChat.mockResolvedValue('  SELECT 1  \n');
    const sql = await generateSQL("test", "t", columns);
    expect(sql).toBe("SELECT 1");
  });

  it("passes the question and schema to the prompt", async () => {
    mockChat.mockResolvedValue("SELECT 1");
    await generateSQL("What is the average revenue?", "my_table", columns);
    expect(mockChat).toHaveBeenCalledTimes(1);
    const messages = mockChat.mock.calls[0][0];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("What is the average revenue?");
    expect(messages[0].content).toContain("my_table");
  });

  it("propagates errors from the chat client", async () => {
    mockChat.mockRejectedValue(new Error("Ollama error: 500"));
    await expect(generateSQL("test", "t", columns)).rejects.toThrow("Ollama error: 500");
  });
});

describe("recommendChart", () => {
  const sampleData = [
    { region: "North", total: 100 },
    { region: "South", total: 200 },
  ];

  it("returns a ChartConfig from valid JSON response", async () => {
    mockChat.mockResolvedValue(
      '{"type":"bar","title":"Revenue by Region","xAxis":"region","yAxis":"total"}'
    );
    const config = await recommendChart(
      "SELECT region, SUM(revenue) as total FROM sales GROUP BY region",
      ["region", "total"],
      sampleData,
      2
    );
    expect(config).not.toBeNull();
    expect(config!.type).toBe("bar");
    expect(config!.title).toBe("Revenue by Region");
    expect(config!.xAxis).toBe("region");
    expect(config!.yAxis).toBe("total");
    expect(config!.id).toBeDefined();
  });

  it("strips markdown code fences from JSON response", async () => {
    mockChat.mockResolvedValue(
      '```json\n{"type":"line","title":"Trend","xAxis":"date","yAxis":"value"}\n```'
    );
    const config = await recommendChart("SELECT *", ["date", "value"], sampleData, 10);
    expect(config).not.toBeNull();
    expect(config!.type).toBe("line");
  });

  it("returns null on invalid JSON", async () => {
    mockChat.mockResolvedValue("I cannot generate a chart for this data");
    const config = await recommendChart("SELECT *", ["a"], sampleData, 1);
    expect(config).toBeNull();
  });

  it("returns null when chat throws an error", async () => {
    mockChat.mockRejectedValue(new Error("network error"));
    const config = await recommendChart("SELECT *", ["a"], sampleData, 1);
    expect(config).toBeNull();
  });

  it("defaults type to bar when missing", async () => {
    mockChat.mockResolvedValue('{"title":"Test","xAxis":"a","yAxis":"b"}');
    const config = await recommendChart("SELECT *", ["a", "b"], sampleData, 1);
    expect(config).not.toBeNull();
    expect(config!.type).toBe("bar");
  });

  it("defaults title to Chart when missing", async () => {
    mockChat.mockResolvedValue('{"type":"pie","xAxis":"a","yAxis":"b"}');
    const config = await recommendChart("SELECT *", ["a", "b"], sampleData, 1);
    expect(config).not.toBeNull();
    expect(config!.title).toBe("Chart");
  });
});

describe("generateSummary", () => {
  const data = [
    { category: "A", total: 100 },
    { category: "B", total: 200 },
  ];

  it("returns the summary text from the AI", async () => {
    mockChat.mockResolvedValue("The total revenue is 300 across 2 categories.");
    const summary = await generateSummary("What is the total?", data, 2);
    expect(summary).toBe("The total revenue is 300 across 2 categories.");
  });

  it("returns empty string when chat throws", async () => {
    mockChat.mockRejectedValue(new Error("connection refused"));
    const summary = await generateSummary("test", data, 2);
    expect(summary).toBe("");
  });

  it("passes the correct messages to chat", async () => {
    mockChat.mockResolvedValue("Summary text");
    await generateSummary("What is the average?", data, 50);
    expect(mockChat).toHaveBeenCalledTimes(1);
    const messages = mockChat.mock.calls[0][0];
    expect(messages[1].content).toContain("What is the average?");
    expect(messages[1].content).toContain("50");
  });
});
