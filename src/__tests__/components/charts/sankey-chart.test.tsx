import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import SankeyChart from "@/components/charts/sankey-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/charts", () => ({ SankeyChart: {} }));
jest.mock("echarts/components", () => ({ TooltipComponent: {} }));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "source",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Lead", "Trial"],
  },
  {
    name: "target",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Trial", "Won"],
  },
  {
    name: "stage",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Qualified", "Won"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [100, 60],
  },
];

const noValueColumns: ColumnProfile[] = columns.filter((column) => column.type !== "number");

async function renderAsync(nextColumns: ColumnProfile[]) {
  await act(async () => {
    render(<SankeyChart tableName="sales" columns={nextColumns} />);
  });

  await waitFor(
    () => {
      expect(
        screen.queryByText("Loading Sankey diagram…"),
      ).not.toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

function getChartOption() {
  const raw = screen.getByTestId("echart").getAttribute("data-option");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function installSankeyMock() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes('CAST("source" AS VARCHAR) AS source_name') && sql.includes('CAST("stage" AS VARCHAR) AS target_name')) {
      return [
        { source_name: "Lead", target_name: "Qualified", flow_value: 50 },
        { source_name: "Trial", target_name: "Won", flow_value: 40 },
      ];
    }

    return [
      { source_name: "Lead", target_name: "Trial", flow_value: 100 },
      { source_name: "Lead", target_name: "Won", flow_value: 60 },
      { source_name: "Trial", target_name: "Won", flow_value: 40 },
    ];
  });
}

describe("SankeyChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders total flow, link counts, and a Sankey option", async () => {
    installSankeyMock();

    await renderAsync(columns);

    expect(await screen.findByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();

    const option = getChartOption();
    const series = option.series as Array<Record<string, unknown>>;
    expect(series[0]?.type).toBe("sankey");
  });

  it("updates node width and gap from the range controls", async () => {
    installSankeyMock();

    await renderAsync(columns);

    await screen.findByTestId("echart");

    const sliders = screen.getAllByRole("slider");
    await act(async () => {
      fireEvent.change(sliders[0] as HTMLInputElement, { target: { value: "30" } });
    });

    await waitFor(() => {
      expect((screen.getAllByRole("slider")[0] as HTMLInputElement).value).toBe("30");
    });

    await act(async () => {
      fireEvent.change(screen.getAllByRole("slider")[1] as HTMLInputElement, {
        target: { value: "20" },
      });
    });

    await waitFor(() => {
      expect((screen.getAllByRole("slider")[1] as HTMLInputElement).value).toBe("20");
      const series = getChartOption().series as Array<Record<string, unknown>>;
      expect(series[0]?.nodeWidth).toBe(30);
      expect(series[0]?.nodeGap).toBe(20);
    });
  });

  it("rebuilds the flow totals when the target column changes", async () => {
    installSankeyMock();

    await renderAsync(columns);

    await screen.findByText("200");
    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[1] as HTMLSelectElement, {
        target: { value: "stage" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading Sankey diagram…")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("90")).toBeInTheDocument();
    });
  });

  it("shows the missing-field error when there is no numeric value column", async () => {
    await renderAsync(noValueColumns);

    expect(
      await screen.findByText("Pick source, target, and value columns."),
    ).toBeInTheDocument();
  });

  it("shows the no-positive-flow error when all flows are non-positive", async () => {
    mockRunQuery.mockResolvedValue([
      { source_name: "Lead", target_name: "Trial", flow_value: 0 },
      { source_name: "Trial", target_name: "Won", flow_value: -5 },
    ]);

    await renderAsync(columns);

    expect(
      await screen.findByText("No positive flows were found for the selected fields."),
    ).toBeInTheDocument();
  });
});
