import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CohortAnalysis from "@/components/data/cohort-analysis";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const mockChartInstance = {
  getDataURL: jest.fn(() => "data:image/png;base64,aGVsbG8="),
};

const chartPropsSpy = jest.fn();

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
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      chartPropsSpy(props);
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => mockChartInstance,
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ HeatmapChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "user_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["u_1", "u_2"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["2025-01-01", "2025-02-01"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [20, 55],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<CohortAnalysis tableName="orders" columns={targetColumns} />);
  });
}

function lastOption() {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return ((lastCall?.[0] as Record<string, unknown>)?.option ?? {}) as Record<
    string,
    unknown
  >;
}

describe("CohortAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows an empty state when no date columns are available", async () => {
    await renderAsync([
      {
        name: "user_id",
        type: "string",
        nullCount: 0,
        uniqueCount: 20,
        sampleValues: ["u1", "u2"],
      },
    ]);

    expect(
      await screen.findByText("Choose a date column to generate cohorts."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads cohort cells and renders the heatmap", async () => {
    mockRunQuery.mockResolvedValue([
      {
        cohort_bucket: "2025-01-01",
        period_index: 0,
        metric_value: 100,
        active_entities: 10,
        cohort_size: 10,
      },
      {
        cohort_bucket: "2025-01-01",
        period_index: 1,
        metric_value: 70,
        active_entities: 7,
        cohort_size: 10,
      },
      {
        cohort_bucket: "2025-02-01",
        period_index: 0,
        metric_value: 120,
        active_entities: 12,
        cohort_size: 12,
      },
    ]);

    await renderAsync(columns);

    expect(await screen.findByText(/Inferred cohort entity/i)).toBeInTheDocument();
    expect(screen.getByText("user_id")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();

    await waitFor(() => {
      const option = lastOption();
      const series = option.series as Array<{ type?: string }>;
      expect(series[0]?.type).toBe("heatmap");
      expect(option.visualMap).toBeDefined();
    });
  });

  it("exports the matrix as PNG and CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      {
        cohort_bucket: "2025-01-01",
        period_index: 0,
        metric_value: 100,
        active_entities: 10,
        cohort_size: 10,
      },
    ]);

    await renderAsync(columns);
    await screen.findByTestId("echart");

    await user.click(screen.getByRole("button", { name: /Export PNG/i }));
    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockChartInstance.getDataURL).toHaveBeenCalled();
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "orders-cohort-analysis.png",
      "image/png",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("cohort_bucket"),
      "orders-cohort-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Cohort failed"));

    await renderAsync(columns);

    expect(await screen.findByText("Cohort failed")).toBeInTheDocument();
  });
});
