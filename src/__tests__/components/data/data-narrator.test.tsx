import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataNarrator from "@/components/data/data-narrator";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

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
    default: function MockChart(props: Record<string, unknown>) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {}, PieChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const richColumns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 10,
    uniqueCount: 90,
    sampleValues: [100, 120, 140],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 85,
    sampleValues: [20, 25, 30],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB", "Mid-market"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["2025-01-01", "2025-02-01"],
  },
];

const structuralColumns: ColumnProfile[] = [
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB", "Mid-market"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: ["2025-01-01", "2025-02-15"],
  },
];

function getSeriesTypes() {
  return chartPropsSpy.mock.calls
    .map((call) => {
      const firstArg = call[0];
      if (
        typeof firstArg === "object" &&
        firstArg !== null &&
        "option" in firstArg &&
        typeof firstArg.option === "object" &&
        firstArg.option !== null &&
        "series" in firstArg.option &&
        Array.isArray(firstArg.option.series)
      ) {
        const firstSeries = firstArg.option.series[0] as Record<string, unknown>;
        return typeof firstSeries?.type === "string" ? firstSeries.type : null;
      }

      return null;
    })
    .filter((value): value is string => value !== null);
}

function mockRichNarrativeQueries() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes('AVG("revenue") AS mean_value')) {
      return [
        {
          mean_value: 120,
          median_value: 110,
          min_value: 80,
          max_value: 240,
          q1: 100,
          q3: 140,
          non_null_count: 90,
          outlier_count: 6,
        },
      ];
    }

    if (sql.includes('AVG("profit") AS mean_value')) {
      return [
        {
          mean_value: 40,
          median_value: 38,
          min_value: 10,
          max_value: 80,
          q1: 25,
          q3: 50,
          non_null_count: 100,
          outlier_count: 1,
        },
      ];
    }

    if (
      sql.includes('COUNT("segment") AS non_null_count') &&
      sql.includes('COUNT(DISTINCT "segment") AS distinct_count')
    ) {
      return [{ non_null_count: 100, distinct_count: 3 }];
    }

    if (sql.includes('CAST("segment" AS VARCHAR) AS value_label')) {
      return [
        { value_label: "Enterprise", value_count: 60 },
        { value_label: "SMB", value_count: 25 },
        { value_label: "Mid-market", value_count: 15 },
      ];
    }

    if (sql.includes('MIN(TRY_CAST("created_at" AS TIMESTAMP)) AS min_value')) {
      return [
        {
          min_value: "2025-01-01T00:00:00.000Z",
          max_value: "2025-03-31T00:00:00.000Z",
          span_days: 89,
        },
      ];
    }

    if (
      sql.includes('corr(TRY_CAST("revenue" AS DOUBLE), TRY_CAST("profit" AS DOUBLE)) AS correlation_value')
    ) {
      return [
        {
          left_name: "revenue",
          right_name: "profit",
          correlation_value: 0.81,
          pair_count: 88,
        },
      ];
    }

    return [];
  });
}

function mockStructuralNarrativeQueries() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (
      sql.includes('COUNT("segment") AS non_null_count') &&
      sql.includes('COUNT(DISTINCT "segment") AS distinct_count')
    ) {
      return [{ non_null_count: 50, distinct_count: 3 }];
    }

    if (sql.includes('CAST("segment" AS VARCHAR) AS value_label')) {
      return [
        { value_label: "Enterprise", value_count: 28 },
        { value_label: "SMB", value_count: 14 },
        { value_label: "Mid-market", value_count: 8 },
      ];
    }

    if (sql.includes('MIN(TRY_CAST("created_at" AS TIMESTAMP)) AS min_value')) {
      return [
        {
          min_value: "2025-01-01T00:00:00.000Z",
          max_value: "2025-02-15T00:00:00.000Z",
          span_days: 45,
        },
      ];
    }

    return [];
  });
}

async function renderNarrator(targetColumns: ColumnProfile[], rowCount: number) {
  await act(async () => {
    render(
      <DataNarrator
        tableName="sales"
        columns={targetColumns}
        rowCount={rowCount}
      />,
    );
  });
}

describe("DataNarrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders a structural fallback narrative when no numeric metrics are available", async () => {
    mockStructuralNarrativeQueries();

    await renderNarrator(structuralColumns, 50);

    expect(
      await screen.findByText(
        "No numeric columns were available, so the metric layer is limited to structural counts instead of true quantitative measures.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add numeric columns to generate metric-centered narrative sections."),
    ).toBeInTheDocument();
  });

  it("builds all narrative sections and mini-chart variants from live query results", async () => {
    mockRichNarrativeQueries();

    await renderNarrator(richColumns, 100);

    expect(
      await screen.findByText("Section-by-section narrative for sales"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Key Metrics" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Recommendations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Category dominance")).toBeInTheDocument();
    expect(screen.getAllByTestId("echart").length).toBeGreaterThanOrEqual(5);

    await waitFor(() => {
      expect(getSeriesTypes()).toEqual(
        expect.arrayContaining(["pie", "bar"]),
      );
    });
  });

  it("scrolls to a section when the navigation buttons are used", async () => {
    const user = userEvent.setup();
    mockRichNarrativeQueries();

    await renderNarrator(richColumns, 100);
    await screen.findByText("Section-by-section narrative for sales");

    await user.click(screen.getByRole("button", { name: "Correlations" }));

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("exports the narrative report as HTML", async () => {
    const user = userEvent.setup();
    mockRichNarrativeQueries();

    await renderNarrator(richColumns, 100);
    await screen.findByText("Section-by-section narrative for sales");

    await user.click(
      screen.getByRole("button", { name: /Export HTML report/i }),
    );

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("<title>sales narrative report</title>"),
      "sales-narrative-report.html",
      "text/html;charset=utf-8;",
    );
  });

  it("falls back to an error narrative when the analysis pipeline fails", async () => {
    mockRunQuery.mockRejectedValue(new Error("Metric pipeline failed"));

    await renderNarrator(richColumns, 100);

    expect(
      await screen.findByText("Narrative generation failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Metric pipeline failed")).toBeInTheDocument();
    expect(
      screen.getAllByText("The analysis pipeline returned early.").length,
    ).toBeGreaterThan(0);
  });
});
