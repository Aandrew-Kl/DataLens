import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnHistogram from "@/components/data/column-histogram";
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
    default: React.forwardRef(function MockChart(
      _props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: () => "data:image/png;base64,AAAA",
        }),
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {} }));
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
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2, 3],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["west", "east", "west"],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<ColumnHistogram tableName="orders" columns={targetColumns} />);
  });
}

describe("ColumnHistogram", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("analyzes a numeric column and shows distribution metrics", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Analyze column" }));

    expect((await screen.findAllByText("2.50")).length).toBeGreaterThan(0);
    expect(screen.getByText("Distribution table")).toBeInTheDocument();
  });

  it("switches to a categorical column and shows top categories", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { value: "west" },
      { value: "west" },
      { value: "east" },
    ]);

    await renderAsync();

    await user.selectOptions(screen.getByRole("combobox"), "category");
    await user.click(screen.getByRole("button", { name: "Analyze column" }));

    expect(await screen.findByText("west")).toBeInTheDocument();
    expect(screen.getByText("Unique values")).toBeInTheDocument();
  });

  it("exports histogram buckets as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Analyze column" }));
    expect((await screen.findAllByText("2.50")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("label,count,start,end"),
      "orders-amount-histogram.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
