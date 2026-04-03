import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SQLPlayground from "@/components/query/sql-playground";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);
const mockExportToCSV = jest.mocked(exportToCSV);
const snippetsStorageKey = "datalens-sql-playground-snippets";

function getEditor(container: HTMLElement) {
  const editor = container.querySelector("textarea");
  if (!(editor instanceof HTMLTextAreaElement)) {
    throw new Error("Expected SQL editor textarea to be rendered");
  }
  return editor;
}

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 20],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
];

describe("SQLPlayground", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("runs a query and records the execution in history", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ revenue: 42, region: "East" }]);

    render(<SQLPlayground tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /^run$/i }));

    expect(await screen.findByRole("cell", { name: "42" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "East" })).toBeInTheDocument();
    expect(screen.getAllByText("Query 1").length).toBeGreaterThan(1);
  });

  it("saves snippets to session storage and opens a new tab", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <SQLPlayground tableName="sales" columns={columns} />,
    );

    const editor = getEditor(container);
    fireEvent.change(editor, {
      target: {
        value: 'SELECT "revenue" FROM "sales";',
        selectionStart: 'SELECT "revenue" FROM "sales";'.length,
      },
    });
    fireEvent.change(screen.getByPlaceholderText("Snippet name"), {
      target: { value: "Revenue only" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description"), {
      target: { value: "Only revenue" },
    });
    await user.click(screen.getByRole("button", { name: /save snippet/i }));

    await waitFor(() => {
      const savedSnippets = JSON.parse(
        window.sessionStorage.getItem(snippetsStorageKey) ?? "[]",
      ) as Array<{ name: string; sql: string }>;
      expect(savedSnippets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Revenue only",
            sql: 'SELECT "revenue" FROM "sales";',
          }),
        ]),
      );
    });

    await user.click(screen.getByRole("button", { name: /add tab/i }));
    const newEditor = getEditor(container);
    expect(newEditor.value).toContain('SELECT *\nFROM "sales"');
  });

  it("loads a saved snippet and shows query errors with fix guidance", async () => {
    const user = userEvent.setup();

    window.sessionStorage.setItem(
      snippetsStorageKey,
      JSON.stringify([
        {
          id: "snippet-1",
          name: "Revenue only",
          description: "Only revenue",
          sql: 'SELECT "revenue" FROM "sales";',
          createdAt: Date.now(),
        },
      ]),
    );
    mockRunQuery.mockRejectedValue(new Error("Parser exploded"));

    const { container } = render(
      <SQLPlayground tableName="sales" columns={columns} />,
    );

    await user.click(await screen.findByRole("button", { name: /^load$/i }));
    expect(getEditor(container).value).toBe('SELECT "revenue" FROM "sales";');

    fireEvent.change(getEditor(container), {
      target: { value: "SEL", selectionStart: 3 },
    });

    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(screen.getByText("Parser exploded")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/DuckDB rejected the SQL syntax/i),
    ).toBeInTheDocument();
  });

  it("exports the active result set as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ revenue: 42, region: "East" }]);

    render(<SQLPlayground tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByRole("cell", { name: "42" });

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockExportToCSV).toHaveBeenCalledWith(
      [{ revenue: 42, region: "East" }],
      "query-1.csv",
    );
  });
});
