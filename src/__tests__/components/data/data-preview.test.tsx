import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import DataPreview from "@/components/data/data-preview";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  { name: "id", type: "number", nullCount: 0, uniqueCount: 2, sampleValues: [1, 2] },
  { name: "name", type: "string", nullCount: 0, uniqueCount: 2, sampleValues: ["Beta", "Alpha"] },
  { name: "amount", type: "number", nullCount: 0, uniqueCount: 2, sampleValues: [10, 20] },
];

const rows = [
  { id: 1, name: "Beta", amount: 10 },
  { id: 2, name: "Alpha", amount: 20 },
];

describe("DataPreview", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    mockRunQuery.mockReset();
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS cnt")) {
        if (sql.includes("%Alpha%")) {
          return [{ cnt: 1 }];
        }
        return [{ cnt: 2 }];
      }

      if (sql.includes("%Alpha%")) {
        return [rows[1]];
      }

      if (sql.includes('ORDER BY "name" IS NULL, "name" ASC')) {
        return [rows[1], rows[0]];
      }

      return rows;
    });
  });

  async function renderPreview() {
    await act(async () => {
      render(<DataPreview tableName="orders" columns={columns} previewRows={rows} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Enhanced preview")).toBeInTheDocument();
    });
  }

  it("loads rows and rebuilds the query when filters and sorting change", async () => {
    await renderPreview();

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getAllByPlaceholderText("Filter...")[1], {
        target: { value: "Alpha" },
      });
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining(`CAST("name" AS VARCHAR) ILIKE '%Alpha%'`),
      );
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    const sortButton = screen.getByText("name").closest("button");
    if (!(sortButton instanceof HTMLElement)) {
      throw new Error("Expected sortable column header button.");
    }

    await act(async () => {
      fireEvent.click(sortButton);
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY "name" IS NULL, "name" ASC'),
      );
    });
  });

  it("shows row detail and copies the selected row as JSON", async () => {
    await renderPreview();

    const betaRow = screen.getByText("Beta").closest("tr");
    if (!(betaRow instanceof HTMLElement)) {
      throw new Error("Expected preview row for Beta.");
    }

    await act(async () => {
      fireEvent.click(betaRow);
    });

    await waitFor(() => {
      expect(screen.getByText("Selected record")).toBeInTheDocument();
      expect(
        screen.getByText(
          (_, element) =>
            element?.tagName === "PRE" &&
            element.textContent?.includes('"name": "Beta"') === true,
        ),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy row as JSON" }));
    });

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        JSON.stringify(rows[0], null, 2),
      );
    });
  });
});
