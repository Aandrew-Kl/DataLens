import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HeatCalendar from "@/components/charts/heat-calendar";
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
jest.mock("echarts/charts", () => ({ HeatmapChart: {} }));
jest.mock("echarts/components", () => ({
  CalendarComponent: {},
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
    uniqueCount: 8,
    sampleValues: ["2024-01-01"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [12, 18],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<HeatCalendar tableName="orders" columns={columns} />);
  });
}

describe("HeatCalendar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the calendar shell and summary cards", async () => {
    mockRunQuery
      .mockResolvedValueOnce([{ year_value: 2024 }])
      .mockResolvedValueOnce([
        { day_key: "2024-01-01", total_value: 10 },
        { day_key: "2024-01-02", total_value: 40 },
      ]);

    await renderComponent();

    expect(
      await screen.findByText("Show daily values as a calendar intensity grid"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("2024-01-02")).toBeInTheDocument();
  });

  it("exports the calendar view as PNG", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([{ year_value: 2024 }])
      .mockResolvedValueOnce([{ day_key: "2024-01-01", total_value: 10 }]);

    await renderComponent();
    await screen.findByText("Show daily values as a calendar intensity grid");

    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      [expect.any(Uint8Array)],
      expect.stringContaining("calendar.png"),
      "image/png",
    );
  });

  it("shows an empty-state error when the selected year has no values", async () => {
    mockRunQuery
      .mockResolvedValueOnce([{ year_value: 2024 }])
      .mockResolvedValueOnce([]);

    await renderComponent();

    expect(
      await screen.findByText("No daily values were found for the selected year."),
    ).toBeInTheDocument();
  });
});
