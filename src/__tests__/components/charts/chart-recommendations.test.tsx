import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ChartRecommendations from "@/components/charts/chart-recommendations";
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

const recommendationColumns: ColumnProfile[] = [
  {
    name: "order_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: ["2024-01-01", "2024-01-02"],
    min: "2024-01-01",
    max: "2024-01-20",
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 40,
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
    uniqueCount: 35,
    sampleValues: [2, 5, 7],
    min: 2,
    max: 7,
    mean: 4.5,
    median: 5,
  },
];

describe("ChartRecommendations", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockReactECharts.mockClear();
    document.documentElement.className = "";
  });

  it("shows the empty recommendation state when the schema has no usable profiles", () => {
    render(
      <ChartRecommendations
        tableName="raw_events"
        columns={[
          {
            name: "payload",
            type: "unknown",
            nullCount: 0,
            uniqueCount: 0,
            sampleValues: [],
          },
        ]}
        rowCount={5}
      />,
    );

    expect(screen.getByText("No confident recommendations yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add at least one usable numeric, date, or categorical profile to unlock chart suggestions.",
      ),
    ).toBeInTheDocument();
  });

  it("builds previews from DuckDB results and reuses cached runs", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { label: "East", value: 12 },
      { label: "West", value: 18 },
    ]);

    render(
      <ChartRecommendations
        tableName="orders"
        columns={recommendationColumns}
        rowCount={100}
      />,
    );

    const barRecommendation = screen.getByRole("button", {
      name: /sales by region/i,
    });
    expect(screen.getByRole("button", { name: /sales over order_date/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /profit vs sales/i })).toBeInTheDocument();

    await user.click(barRecommendation);

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('AVG("sales") AS value'),
      );
    });

    expect(await screen.findByText("2 preview rows")).toBeInTheDocument();
    expect(screen.getByTestId("echarts-preview")).toHaveTextContent("bar");

    await user.click(barRecommendation);

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Cached")).toBeInTheDocument();
  });

  it("shows preview errors when DuckDB rejects a recommendation query", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Preview SQL failed"));

    render(
      <ChartRecommendations
        tableName="orders"
        columns={recommendationColumns}
        rowCount={100}
      />,
    );

    await user.click(screen.getByRole("button", { name: /sales by region/i }));

    expect(await screen.findByText("Preview failed")).toBeInTheDocument();
    expect(screen.getByText("Preview SQL failed")).toBeInTheDocument();
  });
});
