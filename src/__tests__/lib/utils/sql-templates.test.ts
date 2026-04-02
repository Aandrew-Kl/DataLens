import { renderTemplate, SQL_TEMPLATES } from "@/lib/utils/sql-templates";

function getTemplate(templateId: string) {
  const template = SQL_TEMPLATES.find((item) => item.id === templateId);

  expect(template).toBeDefined();
  return template!;
}

describe("renderTemplate", () => {
  it("replaces the table placeholder and provided params", () => {
    expect(
      renderTemplate(
        'SELECT "{{column}}" FROM "{{TABLE}}";',
        "orders",
        { column: "status" },
      ),
    ).toBe('SELECT "status" FROM "orders";');
  });

  it("replaces repeated placeholders globally", () => {
    expect(
      renderTemplate(
        'SELECT "{{column}}", "{{column}}" FROM "{{TABLE}}" ORDER BY "{{column}}";',
        "events",
        { column: "created_at" },
      ),
    ).toBe(
      'SELECT "created_at", "created_at" FROM "events" ORDER BY "created_at";',
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(
      renderTemplate(
        'SELECT {{column}} FROM "{{TABLE}}" WHERE {{missing}} = 1;',
        "events",
        { column: "id", unused: "ignored" },
      ),
    ).toBe('SELECT id FROM "events" WHERE {{missing}} = 1;');
  });

  it("works with an empty params object", () => {
    expect(renderTemplate('SELECT * FROM "{{TABLE}}";', "sales", {})).toBe(
      'SELECT * FROM "sales";',
    );
  });
});

describe("SQL_TEMPLATES", () => {
  it("covers every expected category", () => {
    const categories = new Set(SQL_TEMPLATES.map((template) => template.category));

    expect([...categories].sort()).toEqual([
      "Advanced",
      "Aggregation",
      "Date",
      "Filtering",
      "Text",
      "Window",
    ]);
  });

  it("uses unique template ids", () => {
    const ids = SQL_TEMPLATES.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders quoted identifiers for the group-count template", () => {
    const template = getTemplate("group-count");

    expect(
      renderTemplate(template.template, "orders", { column: "status" }),
    ).toBe(
      'SELECT "status", COUNT(*) AS count\nFROM "orders"\nGROUP BY "status"\nORDER BY count DESC;',
    );
  });

  it("renders an unquoted numeric LIMIT for the top-n template", () => {
    const template = getTemplate("top-n");

    expect(
      renderTemplate(template.template, "orders", { column: "revenue", n: "25" }),
    ).toBe(
      'SELECT *\nFROM "orders"\nORDER BY "revenue" DESC\nLIMIT 25;',
    );
  });

  it("renders quoted string literals for the filter-equals template", () => {
    const template = getTemplate("filter-equals");

    expect(
      renderTemplate(template.template, "orders", {
        column: "status",
        value: "shipped",
      }),
    ).toBe(
      'SELECT *\nFROM "orders"\nWHERE "status" = \'shipped\';',
    );
  });

  it("renders quoted date bounds for the date-range template", () => {
    const template = getTemplate("date-range");

    expect(
      renderTemplate(template.template, "orders", {
        column: "created_at",
        start: "2024-01-01",
        end: "2024-12-31",
      }),
    ).toBe(
      'SELECT *\nFROM "orders"\nWHERE "created_at" BETWEEN \'2024-01-01\' AND \'2024-12-31\'\nORDER BY "created_at";',
    );
  });

  it("renders quoted patterns for the text-search template", () => {
    const template = getTemplate("text-search");

    expect(
      renderTemplate(template.template, "customers", {
        column: "email",
        pattern: "%@example.com",
      }),
    ).toBe(
      'SELECT *\nFROM "customers"\nWHERE "email" ILIKE \'%@example.com\';',
    );
  });

  it("includes the table placeholder and every param placeholder in each template", () => {
    for (const template of SQL_TEMPLATES) {
      expect(template.template).toContain("{{TABLE}}");

      for (const param of template.params) {
        expect(template.template).toContain(`{{${param.key}}}`);
      }
    }
  });
});
