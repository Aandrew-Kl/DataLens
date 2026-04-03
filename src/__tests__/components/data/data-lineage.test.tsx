import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import DataLineage, {
  addLineageEntry,
  type LineageEntry,
} from "@/components/data/data-lineage";
import { runQuery } from "@/lib/duckdb/client";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

function buildEntry(overrides: Partial<LineageEntry> = {}): LineageEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    type: "query",
    description: "Executed a profiling query",
    sql: 'SELECT * FROM "sales";',
    timestamp: new Date("2026-04-03T10:00:00Z").valueOf(),
    rowsBefore: 120,
    rowsAfter: 120,
    ...overrides,
  };
}

describe("DataLineage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders an empty state when there is no lineage for the table", () => {
    render(<DataLineage tableName="lineage-empty-table" />);

    expect(screen.getByText("Data Lineage")).toBeInTheDocument();
    expect(
      screen.getByText(/No lineage recorded for/i),
    ).toHaveTextContent("lineage-empty-table");
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders lineage entries and toggles SQL details", () => {
    const tableName = "lineage-table-with-sql";

    addLineageEntry(
      tableName,
      buildEntry({
        id: "sql-entry",
        type: "transform",
        description: "Trimmed whitespace from customer names",
        sql: 'UPDATE "sales" SET "customer_name" = TRIM("customer_name");',
        rowsBefore: 140,
        rowsAfter: 140,
      }),
    );

    render(<DataLineage tableName={tableName} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(
      screen.getByText("Trimmed whitespace from customer names"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rows before:/i)).toHaveTextContent("140");

    fireEvent.click(screen.getByRole("button", { name: "SQL" }));
    expect(
      screen.getByText(
        'UPDATE "sales" SET "customer_name" = TRIM("customer_name");',
      ),
    ).toBeInTheDocument();
  });

  it("clears the history for the current table", () => {
    const tableName = "lineage-clear-table";

    addLineageEntry(
      tableName,
      buildEntry({
        id: "clear-entry",
        type: "export",
        description: "Exported a CSV snapshot",
        sql: undefined,
      }),
    );

    render(<DataLineage tableName={tableName} />);

    expect(screen.getByText("Exported a CSV snapshot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    expect(
      screen.getByText(/No lineage recorded for/i),
    ).toHaveTextContent(tableName);
  });
});
