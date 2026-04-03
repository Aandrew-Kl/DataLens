import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import SankeyDiagram from "@/components/charts/sankey-diagram";
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
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ SankeyChart: {} }));
jest.mock("echarts/components", () => ({ TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "source",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Lead", "Trial"],
  },
  {
    name: "target",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Trial", "Won"],
  },
  {
    name: "stage",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Qualified", "Won"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [50, 100],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<SankeyDiagram tableName="sales" columns={columns} />);
  });
}

describe("SankeyDiagram", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('CAST("source" AS VARCHAR) AS source_name') && sql.includes('CAST("stage" AS VARCHAR) AS target_name')) {
        return [
          { source_name: "Lead", target_name: "Qualified", flow_value: 30 },
          { source_name: "Trial", target_name: "Won", flow_value: 20 },
        ];
      }
      return [
        { source_name: "Lead", target_name: "Trial", flow_value: 100 },
        { source_name: "Trial", target_name: "Won", flow_value: 40 },
      ];
    });
  });

  it("renders a sankey option and flow totals", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    expect(screen.getByText("140")).toBeInTheDocument();
    const option = JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}") as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("sankey");
  });

  it("rebuilds the flow totals when the target column changes", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByText("140")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    await act(async () => {
      fireEvent.change(selects[1] as HTMLSelectElement, {
        target: { value: "stage" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("50")).toBeInTheDocument();
    });
  });

  it("exports sankey links as CSV", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByText("140")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("source,target,value"),
      "sales-sankey.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
