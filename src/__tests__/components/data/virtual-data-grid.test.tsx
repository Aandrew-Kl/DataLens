import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import VirtualDataGrid from "@/components/data/virtual-data-grid";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [1, 2],
  },
  {
    name: "active",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
  {
    name: "label",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Alpha", "Beta"],
  },
];

describe("VirtualDataGrid", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("loads rows, sorts through DuckDB, and shows the no-match filter state", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*) AS cnt')) {
        return [{ cnt: 0 }];
      }

      if (sql.includes('ORDER BY "amount" IS NULL, "amount" ASC')) {
        return [
          { amount: 1, active: true, label: "Alpha" },
          { amount: 2, active: false, label: "Beta" },
        ];
      }

      if (sql.includes("OFFSET 0")) {
        return [
          { amount: 2, active: false, label: "Beta" },
          { amount: 1, active: true, label: "Alpha" },
        ];
      }

      return [];
    });

    render(
      <VirtualDataGrid
        tableName="orders"
        columns={columns}
        totalRows={2}
      />,
    );

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /amount/i }));
    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY "amount" IS NULL, "amount" ASC'),
      );
    });

    fireEvent.change(screen.getByPlaceholderText("Search across all columns..."), {
      target: { value: "zzz" },
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*) AS cnt'),
      );
    });
    await waitFor(
      () => {
        expect(screen.getByText("No rows match this filter.")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("shows the fetch error when page loading fails", async () => {
    mockRunQuery.mockRejectedValue(new Error("Grid fetch failed"));

    render(
      <VirtualDataGrid
        tableName="orders"
        columns={columns}
        totalRows={10}
      />,
    );

    expect(await screen.findByText("Grid fetch failed")).toBeInTheDocument();
  });
});
