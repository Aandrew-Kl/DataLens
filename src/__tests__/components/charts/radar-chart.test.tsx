import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import RadarChart from "@/components/charts/radar-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/charts", () => ({ RadarChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [120, 150],
  },
  {
    name: "margin",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [0.4, 0.6],
  },
  {
    name: "orders",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [50, 65],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Retail", "Enterprise"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<RadarChart tableName="sales" columns={columns} />);
  });

  await waitFor(
    () => {
      expect(screen.queryByText("Loading radar comparison…")).not.toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

function getChartOption() {
  const raw = screen.getByTestId("echart").getAttribute("data-option");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function installRadarMock(secondRefreshCount?: number) {
  let defaultCalls = 0;

  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("GROUP BY 1")) {
      return [
        {
          group_label: "Retail",
          axis_0: 120,
          axis_1: 0.42,
          axis_2: 55,
          row_count: 25,
        },
        {
          group_label: "Enterprise",
          axis_0: 160,
          axis_1: 0.61,
          axis_2: 70,
          row_count: 15,
        },
      ];
    }

    defaultCalls += 1;

    return [
      {
        group_label: "Dataset average",
        axis_0: 140,
        axis_1: 0.5,
        axis_2: 60,
        row_count:
          defaultCalls > 1 && typeof secondRefreshCount === "number"
            ? secondRefreshCount
            : 40,
      },
    ];
  });
}

describe("RadarChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders radar series data and summary cards", async () => {
    installRadarMock();

    await renderAsync();

    expect(await screen.findByTestId("echart")).toBeInTheDocument();
    expect(screen.getAllByText("Dataset average").length).toBeGreaterThan(0);
    expect(screen.getByText("40")).toBeInTheDocument();

    const option = getChartOption();
    const series = option.series as Array<Record<string, unknown>>;
    expect(series[0]?.type).toBe("radar");
    expect(screen.getByText("Normalization range")).toBeInTheDocument();
  });

  it("groups the radar overlay by the selected category", async () => {
    installRadarMock();

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "segment" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading radar comparison…")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Retail")).toBeInTheDocument();
    });

    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("removes the area fill when the toggle is disabled", async () => {
    installRadarMock();

    await renderAsync();

    await screen.findByTestId("echart");
    expect(screen.getByRole("checkbox")).toBeChecked();

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });

    await waitFor(() => {
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });
  });

  it("shows an error when all axes are removed", async () => {
    installRadarMock();

    await renderAsync();

    await screen.findByTestId("echart");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "revenue" }));
      fireEvent.click(screen.getByRole("button", { name: "margin" }));
      fireEvent.click(screen.getByRole("button", { name: "orders" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading radar comparison…")).not.toBeInTheDocument();
    });

    expect(
      await screen.findByText("Choose at least one numeric axis."),
    ).toBeInTheDocument();
  });

  it("refreshes the radar query on demand", async () => {
    installRadarMock(55);

    await renderAsync();

    await screen.findByTestId("echart");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading radar comparison…")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockRunQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
