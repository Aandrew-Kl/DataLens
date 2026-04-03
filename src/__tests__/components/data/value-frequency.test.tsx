import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import ValueFrequency from "@/components/data/value-frequency";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));
jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    chartPropsSpy(props);
    return null;
  },
}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
}));
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
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["active", "trial"],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["SMB", "Enterprise"],
  },
];

async function renderFrequency(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(
      <ValueFrequency tableName="orders" columns={targetColumns} />,
    );
  });
}

function getLatestChartOption() {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return (lastCall?.[0] as { option?: Record<string, unknown> })?.option ?? {};
}

describe("ValueFrequency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders an empty state when there are no columns", async () => {
    await renderFrequency([]);

    expect(
      screen.getByText("Add at least one column before analyzing value frequency."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders the most frequent values with a bar and cumulative line chart", async () => {
    mockRunQuery.mockResolvedValue([
      { value_label: "active", frequency: 8 },
      { value_label: "trial", frequency: 5 },
      { value_label: "inactive", frequency: 2 },
      { value_label: "(null)", frequency: 1 },
    ]);

    await renderFrequency();

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CASE\n        WHEN "status" IS NULL THEN'),
      );
    });

    expect(screen.getByText("Most Frequent Values")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();

    const option = getLatestChartOption();
    const series = option.series as Array<Record<string, unknown>>;
    expect(series[0]?.type).toBe("bar");
    expect(series[1]?.type).toBe("line");
  });

  it("switches to the least frequent values and exports the selected slice", async () => {
    mockRunQuery.mockResolvedValue([
      { value_label: "active", frequency: 8 },
      { value_label: "trial", frequency: 5 },
      { value_label: "inactive", frequency: 2 },
      { value_label: "(null)", frequency: 1 },
    ]);

    await renderFrequency();

    await screen.findByText("Most Frequent Values");

    fireEvent.change(screen.getByRole("combobox", { name: /ranking/i }), {
      target: { value: "least" },
    });

    expect(await screen.findByText("Least Frequent Values")).toBeInTheDocument();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1] ?? rows[0]).getByText("(null)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("value,frequency,percentage,cumulative_percentage"),
      "orders-status-frequency.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
