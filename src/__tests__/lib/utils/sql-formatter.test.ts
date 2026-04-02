import { formatSQL } from "@/lib/utils/sql-formatter";

describe("formatSQL", () => {
  it("uppercases keywords and splits major clauses", () => {
    const sql = "select id, name from users where active = true order by created_at limit 10";
    expect(formatSQL(sql)).toBe([
      "SELECT",
      "  id,",
      "  name",
      "FROM users",
      "WHERE active = true",
      "ORDER BY created_at",
      "LIMIT 10",
    ].join("\n"));
  });

  it("indents subqueries", () => {
    const sql = "select * from (select id from users where active = true) u";
    expect(formatSQL(sql)).toBe([
      "SELECT",
      "  *",
      "FROM (",
      "  SELECT",
      "    id",
      "  FROM users",
      "  WHERE active = true",
      ") u",
    ].join("\n"));
  });

  it("preserves string literals exactly", () => {
    const sql = "select * from users where note = 'and or select FROM'";
    expect(formatSQL(sql)).toContain("'and or select FROM'");
  });

  it("preserves quoted identifiers", () => {
    const sql = 'select "Group", [Order], `limit` from "users"';
    expect(formatSQL(sql)).toBe([
      "SELECT",
      '  "Group",',
      "  [Order],",
      "  `limit`",
      'FROM "users"',
    ].join("\n"));
  });

  it("breaks logical predicates under WHERE and ON", () => {
    const sql =
      "select * from users join orders on users.id = orders.user_id and orders.status = 'paid' where users.active = true or users.admin = true";
    expect(formatSQL(sql)).toBe([
      "SELECT",
      "  *",
      "FROM users",
      "JOIN orders",
      "  ON users.id = orders.user_id",
      "  AND orders.status = 'paid'",
      "WHERE users.active = true",
      "  OR users.admin = true",
    ].join("\n"));
  });
});
