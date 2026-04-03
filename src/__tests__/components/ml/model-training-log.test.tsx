import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ModelTrainingLog from "@/components/ml/model-training-log";
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
jest.mock("echarts/charts", () => ({ LineChart: {} }));
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
    name: "run_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["run_a", "run_b"],
  },
  {
    name: "epoch",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2],
  },
  {
    name: "loss",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [0.8, 0.6],
  },
  {
    name: "accuracy",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [0.8, 0.9],
  },
  {
    name: "f1_score",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [0.78, 0.85],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ModelTrainingLog tableName="training_runs" columns={columns} />);
  });
}

describe("ModelTrainingLog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the training log viewer before data is loaded", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Inspect training progress across experiment runs",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("loads training runs and renders a multi-run loss chart", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { run_name: "run_a", epoch_value: 1, loss_value: 0.9, accuracy_value: 0.7, f1_value: 0.69 },
      { run_name: "run_a", epoch_value: 2, loss_value: 0.6, accuracy_value: 0.85, f1_value: 0.83 },
      { run_name: "run_b", epoch_value: 1, loss_value: 1.0, accuracy_value: 0.66, f1_value: 0.64 },
      { run_name: "run_b", epoch_value: 2, loss_value: 0.75, accuracy_value: 0.8, f1_value: 0.78 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Load training log" }));

    expect(await screen.findByText("Compared 2 runs across 2 epochs.")).toBeInTheDocument();
    expect(screen.getByText("Best run: run_a")).toBeInTheDocument();

    await waitFor(() => {
      const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
        series?: Array<{ name?: string }>;
      };
      expect(option.series).toHaveLength(2);
      expect(option.series?.[0]?.name).toBe("run_a");
      expect(option.series?.[1]?.name).toBe("run_b");
    });
  });

  it("exports the loaded training log as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { run_name: "run_a", epoch_value: 1, loss_value: 0.9, accuracy_value: 0.7, f1_value: 0.69 },
      { run_name: "run_a", epoch_value: 2, loss_value: 0.6, accuracy_value: 0.85, f1_value: 0.83 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Load training log" }));
    await screen.findByText("Compared 1 runs across 2 epochs.");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("run_name,epoch,loss,accuracy,f1"),
      "training_runs-training-log.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
