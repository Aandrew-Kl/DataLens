import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SeasonalDecomposition from "@/components/analytics/seasonal-decomposition";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockChart() {
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: ["2024-01-01", "2024-01-02"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [10, 20],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<SeasonalDecomposition tableName="orders" columns={targetColumns} />);
  });
}

describe("SeasonalDecomposition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when date or numeric columns are missing", async () => {
    await renderAsync([
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["A", "B"],
      },
    ]);

    expect(
      screen.getByText(
        "Seasonal decomposition needs one date column and one numeric value column.",
      ),
    ).toBeInTheDocument();
  });

  it("decomposes the series and reports strength metrics", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { bucket_date: "2024-01-01", bucket_value: 10 },
      { bucket_date: "2024-01-02", bucket_value: 20 },
      { bucket_date: "2024-01-03", bucket_value: 10 },
      { bucket_date: "2024-01-04", bucket_value: 20 },
      { bucket_date: "2024-01-05", bucket_value: 10 },
      { bucket_date: "2024-01-06", bucket_value: 20 },
      { bucket_date: "2024-01-07", bucket_value: 10 },
      { bucket_date: "2024-01-08", bucket_value: 20 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Decompose series" }));

    expect(await screen.findByText("Decomposition table")).toBeInTheDocument();
    expect(screen.getByText("Detected period")).toBeInTheDocument();
  });

  it("exports the decomposition table as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { bucket_date: "2024-01-01", bucket_value: 10 },
      { bucket_date: "2024-01-02", bucket_value: 20 },
      { bucket_date: "2024-01-03", bucket_value: 10 },
      { bucket_date: "2024-01-04", bucket_value: 20 },
      { bucket_date: "2024-01-05", bucket_value: 10 },
      { bucket_date: "2024-01-06", bucket_value: 20 },
      { bucket_date: "2024-01-07", bucket_value: 10 },
      { bucket_date: "2024-01-08", bucket_value: 20 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Decompose series" }));
    await screen.findByText("Decomposition table");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("date,original,trend,seasonal,residual"),
      "orders-sales-seasonal-decomposition.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
