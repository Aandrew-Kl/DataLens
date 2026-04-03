import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PolarChart from "@/components/charts/polar-chart";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
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
    default: React.forwardRef(function MockChart(
      _props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: () => "data:image/png;base64,QQ==",
        }),
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
}));
jest.mock("echarts/components", () => ({
  AngleAxisComponent: {},
  LegendComponent: {},
  PolarComponent: {},
  RadiusAxisComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "month",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Jan", "Feb"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [12, 18],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [2, 6],
  },
];

async function renderComponent(nextColumns = columns) {
  await act(async () => {
    render(<PolarChart tableName="orders" columns={nextColumns} />);
  });
}

describe("PolarChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the polar comparison shell and series summaries", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { angle_label: "Jan", sales: 10, profit: 4 },
      { angle_label: "Feb", sales: 18, profit: 6 },
    ]);

    await renderComponent();

    expect(
      await screen.findByText("Compare multiple series in polar coordinates"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("Total: 28")).toBeInTheDocument();
    expect(screen.getByText("Peak radius: 18")).toBeInTheDocument();
  });

  it("exports the current polar data as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValueOnce([
      { angle_label: "Jan", sales: 10, profit: 4 },
      { angle_label: "Feb", sales: 18, profit: 6 },
    ]);

    await renderComponent();
    await screen.findByText("Compare multiple series in polar coordinates");

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("angle,sales,profit"),
      "orders-polar.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("shows a validation error when no numeric series are available", async () => {
    await renderComponent([
      {
        name: "month",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["Jan", "Feb"],
      },
    ]);

    expect(
      await screen.findByText("Choose an angle column and at least one numeric radius series."),
    ).toBeInTheDocument();
  });
});
