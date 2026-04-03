import {
  detectSQLType,
  extractColumnNames,
  extractTableNames,
  formatSQL,
  highlightSQL,
  validateSQL,
} from "@/lib/utils/sql-validator";
import { formatSQL as formatSQLBase } from "@/lib/utils/sql-formatter";
import { highlightSQL as highlightSQLBase } from "@/lib/utils/sql-highlight";

describe("validateSQL", () => {
  it("rejects empty SQL", () => {
    expect(validateSQL("   ")).toEqual({
      valid: false,
      errors: [
        {
          code: "empty",
          message: "SQL cannot be empty.",
          position: 0,
        },
      ],
    });
  });

  it("reports unclosed identifiers and unbalanced parentheses", () => {
    const result = validateSQL('SELECT ("users');

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["unclosed_identifier", "unbalanced_parentheses"]),
    );
  });

  it("reports unclosed block comments", () => {
    const result = validateSQL("SELECT 1 /* missing end");

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unclosed_comment",
          message: "Block comment is not closed.",
        }),
      ]),
    );
  });

  it("accepts valid SQL with comments and quoted identifiers", () => {
    const result = validateSQL([
      'SELECT "Group", COUNT(*)',
      'FROM "users"',
      "-- active users only",
      "WHERE active = TRUE",
      'GROUP BY "Group"',
    ].join("\n"));

    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe("extractTableNames", () => {
  it("extracts table names from DDL and DML statements", () => {
    const sql = [
      'CREATE TABLE IF NOT EXISTS "warehouse"."orders" AS SELECT * FROM source_orders;',
      'ALTER TABLE "warehouse"."orders" ADD COLUMN archived BOOLEAN;',
      'DROP TABLE IF EXISTS old_orders;',
      'DELETE FROM sessions;',
      'SELECT * FROM users u JOIN orders o ON u.id = o.user_id;',
      "UPDATE profiles SET active = FALSE;",
    ].join("\n");

    expect(extractTableNames(sql)).toEqual(
      expect.arrayContaining([
        "warehouse.orders",
        "old_orders",
        "sessions",
        "users",
        "orders",
        "profiles",
      ]),
    );
  });
});

describe("extractColumnNames", () => {
  it("extracts columns while skipping functions, keywords, and table identifiers", () => {
    const sql = [
      'SELECT u.id, "Group", SUM(o.total) AS total_amount',
      "FROM users u",
      "JOIN orders o ON u.id = o.user_id",
      "WHERE o.status = 'paid'",
      'GROUP BY u.id, "Group"',
    ].join("\n");

    const columns = extractColumnNames(sql);

    expect(columns).toEqual(
      expect.arrayContaining(["id", "Group", "total", "total_amount", "user_id", "status"]),
    );
    expect(columns).not.toEqual(expect.arrayContaining(["users", "orders", "SUM"]));
  });
});

describe("detectSQLType", () => {
  it.each([
    ["SELECT * FROM users", "select"],
    ["INSERT INTO users VALUES (1)", "insert"],
    ["UPDATE users SET active = true", "update"],
    ["DELETE FROM users", "delete"],
    ["CREATE TABLE users (id INT)", "create"],
    ["DROP TABLE users", "drop"],
    ["ALTER TABLE users ADD COLUMN name TEXT", "alter"],
    ["VACUUM users", "other"],
  ] as const)("classifies %s as %s", (sql, expectedType) => {
    expect(detectSQLType(sql)).toBe(expectedType);
  });
});

describe("wrapper exports", () => {
  it("delegates formatSQL and highlightSQL to the shared utilities", () => {
    const sql = 'select "Group", count(*) from users where active = true';

    expect(formatSQL(sql)).toBe(formatSQLBase(sql));
    expect(highlightSQL(sql)).toEqual(highlightSQLBase(sql));
  });
});
