import { runQuery } from "@/lib/duckdb/client";
import { exportToFormat } from "@/lib/utils/data-export";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result ?? ""));
    };
    reader.onerror = () => {
      reject(reader.error);
    };

    reader.readAsText(blob);
  });
}

describe("exportToFormat", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("exports CSV with escaped cells and the expected SQL query", async () => {
    mockRunQuery.mockResolvedValueOnce([
      {
        name: "Alice, Inc.",
        notes: 'Line "one"\nLine two',
      },
    ]);

    const blob = await exportToFormat("orders", ["name", "notes"], "csv", {
      where: "status = 'open'",
      orderBy: "created_at DESC",
      limit: 5,
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      'SELECT "name", "notes" FROM "orders" WHERE status = \'open\' ORDER BY created_at DESC LIMIT 5',
    );
    expect(blob.type).toBe("text/csv;charset=utf-8");
    await expect(readBlobText(blob)).resolves.toBe(
      'name,notes\n"Alice, Inc.","Line ""one""\nLine two"',
    );
  });

  it("exports JSON arrays when headers are disabled", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);

    const blob = await exportToFormat("orders", ["id", "name"], "json", {
      includeHeaders: false,
      prettyPrint: false,
    });

    expect(blob.type).toBe("application/json;charset=utf-8");
    await expect(readBlobText(blob)).resolves.toBe('[[1,"Alice"],[2,"Bob"]]');
  });

  it("exports SQL INSERT statements with typed literal formatting", async () => {
    mockRunQuery.mockResolvedValueOnce([
      {
        id: 1,
        active: true,
        created_at: new Date("2024-01-01T00:00:00.000Z"),
        note: "O'Reilly",
        empty: null,
      },
    ]);

    const blob = await exportToFormat(
      "source_orders",
      ["id", "active", "created_at", "note", "empty"],
      "sql",
      {
        tableName: "archived_orders",
      },
    );

    expect(blob.type).toBe("application/sql;charset=utf-8");
    await expect(readBlobText(blob)).resolves.toBe(
      'INSERT INTO "archived_orders" ("id", "active", "created_at", "note", "empty") VALUES (1, TRUE, \'2024-01-01T00:00:00.000Z\', \'O\'\'Reilly\', NULL);',
    );
  });

  it("exports Markdown tables with inferred headers and escaped content", async () => {
    mockRunQuery.mockResolvedValueOnce([
      {
        name: "A|B",
        note: "Line 1\nLine 2",
      },
    ]);

    const blob = await exportToFormat("orders", [], "markdown");
    const text = await readBlobText(blob);

    expect(text).toContain("| name | note |");
    expect(text).toContain("| --- | --- |");
    expect(text).toContain("A\\|B");
    expect(text).toContain("Line 1<br />Line 2");
  });

  it("exports HTML tables without headers when requested and escapes markup", async () => {
    mockRunQuery.mockResolvedValueOnce([
      {
        name: "<Admin>",
        note: "A&B",
      },
    ]);

    const blob = await exportToFormat("orders", [], "html", {
      includeHeaders: false,
      tableName: "Executive <Report>",
    });
    const text = await readBlobText(blob);

    expect(mockRunQuery).toHaveBeenCalledWith('SELECT * FROM "orders"');
    expect(blob.type).toBe("text/html;charset=utf-8");
    expect(text).toContain("<title>Executive &lt;Report&gt;</title>");
    expect(text).toContain("1 exported row");
    expect(text).not.toContain("<thead>");
    expect(text).toContain("&lt;Admin&gt;");
    expect(text).toContain("A&amp;B");
  });
});
