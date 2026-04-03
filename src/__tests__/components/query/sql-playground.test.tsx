import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("East")).toBeInTheDocument();
    expect(screen.getAllByText("Query 1").length).toBeGreaterThan(1);
  });

  it("saves snippets, opens a new tab, and loads a saved query into it", async () => {
    const user = userEvent.setup();

    render(<SQLPlayground tableName="sales" columns={columns} />);

    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'SELECT "revenue" FROM "sales";');

    await user.type(screen.getByPlaceholderText("Snippet name"), "Revenue only");
    await user.type(screen.getByPlaceholderText("Description"), "Only revenue");
    await user.click(screen.getByRole("button", { name: /save snippet/i }));

    expect(await screen.findByText("Revenue only")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add tab/i }));
    const newEditor = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(newEditor.value).toContain('SELECT *\nFROM "sales"');

    await user.click(screen.getByRole("button", { name: /^load$/i }));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      'SELECT "revenue" FROM "sales";',
    );
  });

  it("shows autocomplete suggestions and query errors with fix guidance", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Parser exploded"));

    render(<SQLPlayground tableName="sales" columns={columns} />);

    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, "SEL");

    await user.click(await screen.findByRole("button", { name: "SELECT" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "SELECT",
    );

    await user.click(screen.getByRole("button", { name: /^run$/i }));

    expect(await screen.findByText("Parser exploded")).toBeInTheDocument();
    expect(
      screen.getByText(/DuckDB rejected the SQL syntax/i),
    ).toBeInTheDocument();
  });

  it("exports the active result set as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ revenue: 42, region: "East" }]);

    render(<SQLPlayground tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByText("42");

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockExportToCSV).toHaveBeenCalledWith(
      [{ revenue: 42, region: "East" }],
      "query-1.csv",
    );
  });
});
