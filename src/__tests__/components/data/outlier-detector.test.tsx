import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import OutlierDetector from "@/components/data/outlier-detector";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const numericColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [10, 20, 30],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B"],
  },
];

describe("OutlierDetector", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders a message when there are no numeric columns", () => {
    render(
      <OutlierDetector
        tableName="orders"
        columns={[
          {
            name: "segment",
            type: "string",
            nullCount: 0,
            uniqueCount: 3,
            sampleValues: ["A", "B"],
          },
        ]}
      />,
    );

    expect(screen.getByText("No numeric columns available")).toBeInTheDocument();
  });

  it("loads outlier summaries and expands the outlier row preview", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("quantile_cont")) {
        return [
          {
            q1: 10,
            q3: 20,
            iqr: 10,
            lower_bound: -5,
            upper_bound: 35,
            non_null_count: 100,
            outlier_count: 2,
          },
        ];
      }

      if (sql.includes("GROUP BY value")) {
        return [{ value: 50, frequency: 2, deviation: 35 }];
      }

      if (sql.includes('"__deviation"')) {
        return [{ sales: 50, segment: "Enterprise", __deviation: 35 }];
      }

      return [];
    });

    render(<OutlierDetector tableName="orders" columns={numericColumns} />);

    expect(await screen.findByText("sales")).toBeInTheDocument();
    expect(screen.getByText("50 × 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /View outlier rows/i }));

    expect(await screen.findByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByText("Hide outlier rows")).toBeInTheDocument();
  });

  it("shows summary loading errors", async () => {
    mockRunQuery.mockRejectedValue(new Error("Outlier scan failed"));

    render(<OutlierDetector tableName="orders" columns={numericColumns} />);

    expect(await screen.findByText("Outlier scan failed")).toBeInTheDocument();
  });
});
