import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import DataWrangler from "@/components/data/data-wrangler";
import { appendLineageEvent } from "@/components/data/data-lineage-graph";
import { getTableRowCount, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  getTableRowCount: jest.fn().mockResolvedValue(0),
}));

jest.mock("@/lib/duckdb/profiler", () => ({
  profileTable: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/components/data/data-lineage-graph", () => ({
  appendLineageEvent: jest.fn(),
}));

jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);
const mockGetTableRowCount = jest.mocked(getTableRowCount);
const mockProfileTable = jest.mocked(profileTable);
const mockAppendLineageEvent = jest.mocked(appendLineageEvent);

const columns: ColumnProfile[] = [
  {
    name: "full_name",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Ada,Lovelace", "Grace,Hopper"],
  },
  {
    name: "score",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [10, 20],
  },
];

describe("DataWrangler", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockGetTableRowCount.mockReset();
    mockProfileTable.mockReset();
    mockAppendLineageEvent.mockReset();

    mockProfileTable.mockResolvedValue(columns);
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM "orders" LIMIT 10')) {
        return [{ full_name: "Ada,Lovelace", score: 10 }];
      }

      if (sql.includes("preview_count")) {
        return [{ cnt: 1 }];
      }

      if (sql.includes('SELECT COUNT(*) AS cnt FROM "orders"')) {
        return [{ cnt: 1 }];
      }

      if (sql.includes('split_part(CAST("full_name" AS VARCHAR)')) {
        return [
          {
            full_name: "Ada,Lovelace",
            score: 10,
            full_name_split_1: "Ada",
            full_name_split_2: "Lovelace",
          },
        ];
      }

      return [];
    });
  });

  async function renderWrangler() {
    await act(async () => {
      render(<DataWrangler tableName="orders" columns={columns} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Data wrangler")).toBeInTheDocument();
    });
  }

  it("builds a preview for the current operation", async () => {
    await renderWrangler();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Before preview")).toBeInTheDocument();
      expect(screen.getByText("After preview")).toBeInTheDocument();
      expect(screen.getAllByText("Ada,Lovelace")).toHaveLength(2);
      expect(screen.getByText("Lovelace")).toBeInTheDocument();
    });
  });

  it("applies a transform, records lineage, and supports undoing the latest step", async () => {
    mockGetTableRowCount
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(12);

    await renderWrangler();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply SQL transform" }));
    });

    await waitFor(() => {
      expect(
        screen.getByText('Split full_name by "," applied to orders.'),
      ).toBeInTheDocument();
      expect(mockAppendLineageEvent).toHaveBeenCalledWith(
        "orders",
        expect.objectContaining({
          type: "transform",
          label: 'Split full_name by ","',
        }),
      );
      expect(screen.getByText("Undo this step")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo latest" }));
    });

    await waitFor(() => {
      expect(screen.getByText('Undid Split full_name by ",".')).toBeInTheDocument();
      expect(mockAppendLineageEvent).toHaveBeenCalledTimes(2);
      expect(screen.getByText("undone")).toBeInTheDocument();
    });
  });
});
