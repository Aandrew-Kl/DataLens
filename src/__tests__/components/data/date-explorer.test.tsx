import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DateExplorer from "@/components/data/date-explorer";
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
jest.mock("echarts/charts", () => ({
  BarChart: {},
  HeatmapChart: {},
  LineChart: {},
}));
jest.mock("echarts/components", () => ({
  CalendarComponent: {},
  GridComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["2025-01-01", "2025-01-03"],
  },
  {
    name: "closed_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: ["2025-02-01", "2025-02-02"],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<DateExplorer tableName="sales" columns={targetColumns} />);
  });
}

function lastOption() {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return ((lastCall?.[0] as Record<string, unknown>)?.option ?? {}) as Record<
    string,
    unknown
  >;
}

describe("DateExplorer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when there are no date columns", async () => {
    await renderAsync([
      {
        name: "amount",
        type: "number",
        nullCount: 0,
        uniqueCount: 10,
        sampleValues: [10, 20],
      },
    ]);

    expect(
      await screen.findByText("Choose a date column to explore temporal activity."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads calendar, weekday, hourly, and gap findings", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("day_bucket")) {
        return [
          { day_bucket: "2025-01-01", row_count: 5 },
          { day_bucket: "2025-01-03", row_count: 8 },
          { day_bucket: "2025-02-01", row_count: 9 },
        ];
      }
      return [
        { hour_of_day: 9, row_count: 3 },
        { hour_of_day: 15, row_count: 2 },
      ];
    });

    await renderAsync(columns);

    expect(await screen.findByText("Gap detection")).toBeInTheDocument();
    expect(screen.getByText("Jan 2, 2025")).toBeInTheDocument();

    await waitFor(() => {
      const option = lastOption();
      const series = option.series as Array<{ type?: string }>;
      expect(series[0]?.type).toBe("line");
    });
  });

  it("changes the active date column and reloads the queries", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('"closed_at"')) {
        if (sql.includes("day_bucket")) {
          return [
            { day_bucket: "2025-02-01", row_count: 4 },
            { day_bucket: "2025-02-02", row_count: 6 },
          ];
        }
        return [{ hour_of_day: 0, row_count: 10 }];
      }

      if (sql.includes("day_bucket")) {
        return [{ day_bucket: "2025-01-01", row_count: 5 }];
      }
      return [{ hour_of_day: 9, row_count: 1 }];
    });

    await renderAsync(columns);
    await screen.findByText("Gap detection");

    await user.selectOptions(screen.getByLabelText(/Date column/i), "closed_at");

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('"closed_at"'),
      );
    });
  });

  it("exports the calendar heatmap as PNG", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("day_bucket")) {
        return [{ day_bucket: "2025-01-01", row_count: 5 }];
      }
      return [{ hour_of_day: 9, row_count: 1 }];
    });

    await renderAsync(columns);
    await screen.findAllByTestId("echart");

    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "sales-created_at-calendar.png",
      "image/png",
    );
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Date explorer failed"));

    await renderAsync(columns);

    expect(await screen.findByText("Date explorer failed")).toBeInTheDocument();
  });
});
