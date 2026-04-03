import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import OutlierRemoval from "@/components/data/outlier-removal";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const numericColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 1,
    uniqueCount: 8,
    sampleValues: [12, 18, 120],
    mean: 30,
    median: 18,
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["SMB", "Enterprise"],
  },
];

async function renderTool(targetColumns: ColumnProfile[] = numericColumns) {
  await act(async () => {
    render(<OutlierRemoval tableName="orders" columns={targetColumns} />);
  });
}

describe("OutlierRemoval", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a clear empty state when there are no numeric columns", async () => {
    await renderTool([
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["SMB", "Enterprise"],
      },
    ]);

    expect(
      screen.getByText("No numeric columns are available for outlier removal."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("previews flagged rows and exports the preview CSV", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("clean_numeric_rows")) {
        return [
          {
            total_rows: 10,
            total_numeric_rows: 9,
            removed_rows: 2,
            clean_rows: 8,
            mean_before: 30,
            mean_after: 15,
            stddev_before: 35,
            stddev_after: 4,
            min_before: 10,
            min_after: 10,
            max_before: 120,
            max_after: 22,
          },
        ];
      }

      if (sql.includes("ORDER BY ABS(__metric")) {
        return [
          {
            __row_id: 4,
            amount: 120,
            segment: "Enterprise",
            __metric: 120,
            __is_outlier: true,
          },
          {
            __row_id: 7,
            amount: 98,
            segment: "Mid-market",
            __metric: 98,
            __is_outlier: true,
          },
        ];
      }

      return [];
    });

    await renderTool();

    fireEvent.click(screen.getByRole("button", { name: "Preview removal" }));

    expect(await screen.findByText("Preview ready for 2 rows.")).toBeInTheDocument();
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByText("Mid-market")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
    expect(String(mockDownloadFile.mock.calls[0]?.[0])).toContain("row_id");
    expect(String(mockDownloadFile.mock.calls[0]?.[0])).toContain("metric_value");
    expect(String(mockDownloadFile.mock.calls[0]?.[0])).toContain("Enterprise");
    expect(mockDownloadFile.mock.calls[0]?.[1]).toBe("orders-amount-outliers.csv");
  });

  it("applies a clean table using the active z-score configuration", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1234);

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("clean_numeric_rows")) {
        return [
          {
            total_rows: 10,
            total_numeric_rows: 9,
            removed_rows: 1,
            clean_rows: 9,
            mean_before: 30,
            mean_after: 18,
            stddev_before: 35,
            stddev_after: 5,
            min_before: 10,
            min_after: 10,
            max_before: 120,
            max_after: 24,
          },
        ];
      }

      if (sql.includes("ORDER BY ABS(__metric")) {
        return [
          {
            __row_id: 4,
            amount: 120,
            segment: "Enterprise",
            __metric: 120,
            __is_outlier: true,
          },
        ];
      }

      return [];
    });

    await renderTool();

    fireEvent.change(screen.getByLabelText("Method"), {
      target: { value: "zscore" },
    });
    fireEvent.change(screen.getByLabelText("Z-score threshold"), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview removal" }));

    expect(await screen.findByText("Preview ready for 1 rows.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply clean table" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE "orders__clean_1234" AS'),
      );
    });

    const createCall = mockRunQuery.mock.calls.find(([sql]) =>
      sql.includes('CREATE TABLE "orders__clean_1234" AS'),
    )?.[0];

    expect(createCall).toContain(
      "ABS((__metric - mean_before) / stddev_before) >= 2.5",
    );
    expect(
      await screen.findByText('Created clean table orders__clean_1234.'),
    ).toBeInTheDocument();

    nowSpy.mockRestore();
  });
});
