import { highlightSQL } from "@/lib/utils/sql-highlight";

describe("highlightSQL", () => {
  it("tokenizes a simple SELECT query", () => {
    const tokens = highlightSQL('SELECT * FROM "users"');
    const types = tokens.map((t) => t.type);
    expect(types).toContain("keyword");
    expect(types).toContain("identifier");
  });

  it("identifies SQL keywords", () => {
    const tokens = highlightSQL("SELECT COUNT FROM WHERE GROUP BY ORDER LIMIT");
    const keywords = tokens.filter((t) => t.type === "keyword");
    expect(keywords.length).toBeGreaterThanOrEqual(5);
  });

  it("identifies SQL functions", () => {
    const tokens = highlightSQL("SELECT COUNT(*), SUM(amount), AVG(price)");
    const functions = tokens.filter((t) => t.type === "function");
    expect(functions.length).toBe(3);
  });

  it("identifies string literals", () => {
    const tokens = highlightSQL("SELECT * FROM t WHERE name = 'hello'");
    const strings = tokens.filter((t) => t.type === "string");
    expect(strings.length).toBe(1);
    expect(strings[0].text).toContain("hello");
  });

  it("identifies numbers", () => {
    const tokens = highlightSQL("SELECT * FROM t LIMIT 100");
    const numbers = tokens.filter((t) => t.type === "number");
    expect(numbers.length).toBe(1);
    expect(numbers[0].text).toBe("100");
  });

  it("identifies double-quoted identifiers", () => {
    const tokens = highlightSQL('SELECT "column_name" FROM "my_table"');
    const identifiers = tokens.filter((t) => t.type === "identifier");
    expect(identifiers.length).toBe(2);
  });

  it("handles empty input", () => {
    const tokens = highlightSQL("");
    expect(tokens).toEqual([]);
  });

  it("identifies operators", () => {
    const tokens = highlightSQL("SELECT * FROM t WHERE a >= 10 AND b != 20");
    const operators = tokens.filter((t) => t.type === "operator");
    expect(operators.length).toBeGreaterThanOrEqual(2);
  });

  it("handles single-line comments", () => {
    const tokens = highlightSQL("SELECT * -- this is a comment\nFROM t");
    const comments = tokens.filter((t) => t.type === "comment");
    expect(comments.length).toBe(1);
  });

  it("preserves all original text", () => {
    const sql = 'SELECT "name", COUNT(*) FROM "users" GROUP BY "name"';
    const tokens = highlightSQL(sql);
    const reconstructed = tokens.map((t) => t.text).join("");
    expect(reconstructed).toBe(sql);
  });
});
