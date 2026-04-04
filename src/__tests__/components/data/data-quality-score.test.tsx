import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataQualityScore from "@/components/data/data-quality-score";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: (_target, tag) =>
          React.forwardRef(function MockMotion(
            props: Record<string, unknown> & { children?: ReactNode },
            ref: React.Ref<Element>,
          ) {
            return React.createElement(String(tag), { ...props, ref }, props.children);
          }),
      },
    ),
  };
});

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart() {
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ RadarChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  RadarComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const qualityColumns: ColumnProfile[] = [
  {
    name: "order_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2, 3],
  },
  {
    name: "joined_at",
    type: "date",
    nullCount: 1,
    uniqueCount: 8,
    sampleValues: ["2026-01-01", "bad-date"],
  },
];

async function renderScorecard() {
  await act(async () => {
    render(<DataQualityScore tableName="orders" columns={qualityColumns} />);
  });
}

describe("DataQualityScore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calculates overall and per-dimension quality metrics", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ row_count: 10 }]);

    await renderScorecard();
    await user.click(screen.getByRole("button", { name: /calculate quality score/i }));

    expect(await screen.findByText(/Overall quality score/i)).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(
      screen.getByText(/Add validation rules for invalid dates, numbers, or booleans/i),
    ).toBeInTheDocument();
  });

  it("exports the scorecard report after calculation", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ row_count: 10 }]);

    await renderScorecard();
    await user.click(screen.getByRole("button", { name: /calculate quality score/i }));
    await screen.findByText(/Overall quality score/i);

    await user.click(screen.getByRole("button", { name: /export report/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Array),
      "orders-quality-report.txt",
      "text/plain;charset=utf-8",
    );
  });

  it("surfaces DuckDB errors while calculating the scorecard", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockRejectedValue(new Error("quality failed"));

    await renderScorecard();
    await user.click(screen.getByRole("button", { name: /calculate quality score/i }));

    expect(await screen.findByText("quality failed")).toBeInTheDocument();
  });
});
