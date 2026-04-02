import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimeSeriesAnalyzer from "@/components/data/time-series-analyzer";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

type MockChartProps = {
  option: {
    series?: Array<{ type?: string }>;
  };
};

const mockReactECharts = jest.fn(({ option }: MockChartProps) => (
  <div data-testid="echarts-preview">
    {option.series?.map((series) => series.type ?? "unknown").join(",")}
  </div>
));

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react", () => ({
  __esModule: true,
  default: (props: MockChartProps) => mockReactECharts(props),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const analyzerColumns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["2024-01-01", "2024-01-02", "2024-01-03"],
    min: "2024-01-01",
    max: "2024-01-03",
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [10, 20, 30],
    min: 10,
    max: 30,
    mean: 20,
    median: 20,
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [5, 10, 20],
    min: 5,
    max: 20,
    mean: 11.67,
    median: 10,
  },
];

describe("TimeSeriesAnalyzer", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockReactECharts.mockClear();
    document.documentElement.className = "";
  });

  it("shows the missing-column guard when the dataset is not time-series ready", () => {
    render(
      <TimeSeriesAnalyzer
        tableName="orders"
        columns={[
          {
            name: "sales",
            type: "number",
            nullCount: 0,
            uniqueCount: 3,
            sampleValues: [10, 20, 30],
          },
        ]}
      />,
    );

    expect(screen.getByText("Insufficient columns")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This tool needs at least one date column and one numeric column.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads a series, renders the analysis, and reacts to control changes", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('TRY_CAST("sales" AS DOUBLE)')) {
        return [
          { bucket_date: "2024-01-01", bucket_value: 10, row_count: 2 },
          { bucket_date: "2024-01-02", bucket_value: 20, row_count: 3 },
          { bucket_date: "2024-01-03", bucket_value: 30, row_count: 4 },
        ];
      }

      if (sql.includes('TRY_CAST("profit" AS DOUBLE)')) {
        return [
          { bucket_date: "2024-01-01", bucket_value: 5, row_count: 2 },
          { bucket_date: "2024-01-02", bucket_value: 10, row_count: 2 },
          { bucket_date: "2024-01-03", bucket_value: 20, row_count: 2 },
        ];
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    render(<TimeSeriesAnalyzer tableName="orders" columns={analyzerColumns} />);

    expect(await screen.findByText("Daily cadence")).toBeInTheDocument();
    expect(screen.getByText("200.0%")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("Jan 1, 2024 to Jan 3, 2024")).toBeInTheDocument();
    expect(screen.getByText("3 buckets from 9 non-null rows.")).toBeInTheDocument();
    expect(screen.getAllByTestId("echarts-preview")).toHaveLength(2);

    fireEvent.change(screen.getByRole("slider"), {
      target: { value: "2" },
    });
    expect(screen.getByText("2 periods")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Numeric column"), "profit");

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(2);
    });
    expect(mockRunQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('TRY_CAST("profit" AS DOUBLE)'),
    );
    expect(
      screen.getByText(/seasonal profile built from profit/i),
    ).toBeInTheDocument();
  });

  it("surfaces DuckDB query failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Series query failed"));

    render(<TimeSeriesAnalyzer tableName="orders" columns={analyzerColumns} />);

    expect(await screen.findByText("Series query failed")).toBeInTheDocument();
    expect(screen.queryByTestId("echarts-preview")).not.toBeInTheDocument();
  });
});
