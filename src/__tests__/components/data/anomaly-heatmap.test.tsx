import { render, screen } from "@testing-library/react";

import AnomalyHeatmap from "@/components/data/anomaly-heatmap";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("echarts-for-react");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const heatmapColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [10, 11, 20],
  },
  {
    name: "margin",
    type: "number",
    nullCount: 0,
    uniqueCount: 1,
    sampleValues: [5],
  },
];

describe("AnomalyHeatmap", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders a neutral state when numeric columns are missing", () => {
    render(
      <AnomalyHeatmap
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

  it("renders the heatmap, risk ranking, and strongest deviations", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("WITH stats AS")) {
        return [
          {
            c0_mean: 10,
            c0_stddev: 2,
            c0_count: 3,
            c0_anomaly_count: 1,
            c1_mean: 5,
            c1_stddev: 0,
            c1_count: 3,
            c1_anomaly_count: 0,
          },
        ];
      }

      if (sql.includes("WITH indexed AS")) {
        return [
          { row_id: 2, amount: 20, margin: 5 },
          { row_id: 1, amount: 11, margin: 5 },
        ];
      }

      return [];
    });

    render(<AnomalyHeatmap tableName="orders" columns={heatmapColumns} />);

    expect(
      await screen.findByText("1 flagged cells across the table"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
    expect(screen.getAllByText("amount").length).toBeGreaterThan(0);
    expect(screen.getByText("+5.00σ")).toBeInTheDocument();
  });

  it("shows the fetch error when anomaly scoring fails", async () => {
    mockRunQuery.mockRejectedValue(new Error("Heatmap failed"));

    render(<AnomalyHeatmap tableName="orders" columns={heatmapColumns} />);

    expect(await screen.findByText("Heatmap failed")).toBeInTheDocument();
  });
});
