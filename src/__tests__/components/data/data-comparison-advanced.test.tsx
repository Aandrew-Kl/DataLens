import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataComparisonAdvanced from "@/components/data/data-comparison-advanced";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const leftColumns: ColumnProfile[] = [
  {
    name: "price",
    type: "number",
    nullCount: 2,
    uniqueCount: 80,
    sampleValues: [10, 20],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B"],
  },
  {
    name: "legacy_flag",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

const rightColumns: ColumnProfile[] = [
  {
    name: "price",
    type: "number",
    nullCount: 1,
    uniqueCount: 82,
    sampleValues: [12, 24],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["A", "C"],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Retail", "SMB"],
  },
];

const datasets = [
  { tableName: "sales_2025", columns: leftColumns, rowCount: 100 },
  { tableName: "sales_2026", columns: rightColumns, rowCount: 120 },
];

describe("DataComparisonAdvanced", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders mapped comparisons and exports the HTML report", async () => {
    const user = userEvent.setup();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    mockRunQuery.mockImplementation(async (sql) => {
      if (
        sql.includes('FROM "sales_2025"') &&
        sql.includes('AVG(TRY_CAST("price" AS DOUBLE))')
      ) {
        return [
          {
            mean_value: 20,
            median_value: 18,
            stddev_value: 4,
            null_count: 2,
          },
        ];
      }
      if (
        sql.includes('FROM "sales_2026"') &&
        sql.includes('AVG(TRY_CAST("price" AS DOUBLE))')
      ) {
        return [
          {
            mean_value: 24,
            median_value: 21,
            stddev_value: 5,
            null_count: 1,
          },
        ];
      }
      if (
        sql.includes('FROM "sales_2025"') &&
        sql.includes('AVG(TRY_CAST("category" AS DOUBLE))')
      ) {
        return [
          {
            mean_value: null,
            median_value: null,
            stddev_value: null,
            null_count: 0,
          },
        ];
      }
      if (
        sql.includes('FROM "sales_2026"') &&
        sql.includes('AVG(TRY_CAST("category" AS DOUBLE))')
      ) {
        return [
          {
            mean_value: null,
            median_value: null,
            stddev_value: null,
            null_count: 0,
          },
        ];
      }
      if (sql.includes("overlap_count")) {
        return [{ overlap_count: 3, union_count: 4 }];
      }
      if (
        sql.includes('SELECT TRY_CAST("price" AS DOUBLE) AS value') &&
        sql.includes('FROM "sales_2025"')
      ) {
        return [{ value: 10 }, { value: 20 }, { value: 30 }];
      }
      if (
        sql.includes('SELECT TRY_CAST("price" AS DOUBLE) AS value') &&
        sql.includes('FROM "sales_2026"')
      ) {
        return [{ value: 12 }, { value: 22 }, { value: 32 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    render(<DataComparisonAdvanced datasets={datasets} />);

    expect(await screen.findByText("legacy_flag")).toBeInTheDocument();
    expect(screen.getByText("segment")).toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();
    expect(screen.getByText("category")).toBeInTheDocument();
    expect(screen.getByText("0.200")).toBeInTheDocument();
    expect(screen.getByText("Distribution comparison")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /export comparison report/i }),
    );

    expect(await screen.findByText(/Exported the comparison report as HTML\./i)).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("shows the empty histogram state when no numeric columns are mapped", async () => {
    render(
      <DataComparisonAdvanced
        datasets={[
          {
            tableName: "left",
            rowCount: 10,
            columns: [
              {
                name: "status",
                type: "string",
                nullCount: 0,
                uniqueCount: 2,
                sampleValues: ["open", "closed"],
              },
            ],
          },
          {
            tableName: "right",
            rowCount: 10,
            columns: [
              {
                name: "status",
                type: "string",
                nullCount: 0,
                uniqueCount: 2,
                sampleValues: ["open", "closed"],
              },
            ],
          },
        ]}
      />,
    );

    expect(
      await screen.findByText(
        /Map numeric columns on both sides to see an overlay histogram\./i,
      ),
    ).toBeInTheDocument();
  });

  it("surfaces query failures during comparison", async () => {
    mockRunQuery.mockRejectedValue(new Error("Comparison failed"));

    render(<DataComparisonAdvanced datasets={datasets} />);

    await waitFor(() => {
      expect(screen.getByText("Comparison failed")).toBeInTheDocument();
    });
  });
});
