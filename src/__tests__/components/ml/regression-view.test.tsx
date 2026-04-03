import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RegressionView from "@/components/ml/regression-view";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      return React.createElement("div", { ref, "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {}, ScatterChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockExportToCSV = jest.mocked(exportToCSV);

const columns: ColumnProfile[] = [
  {
    name: "spend",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [2, 4],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2],
  },
];

function mockLinearRegression() {
  mockRunQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("COUNT(*) AS row_count")) {
      return [
        {
          row_count: 3,
          sx0: 3,
          sx1: 6,
          sx2: 14,
          sxy0: 12,
          sxy1: 28,
        },
      ];
    }

    if (sql.includes("ORDER BY x_value")) {
      return [
        { x_value: 1, y_value: 2 },
        { x_value: 2, y_value: 4 },
        { x_value: 3, y_value: 6 },
      ];
    }

    return [];
  });
}

describe("RegressionView", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockExportToCSV.mockReset();
    mockLinearRegression();
  });

  it("renders the regression workspace with initial guidance", () => {
    const user = userEvent.setup();

    render(<RegressionView tableName="orders" columns={columns} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Linear and polynomial least-squares fitting",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose X and Y numeric columns, then fit a model."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("X value for prediction")).toBeInTheDocument();

    void user;
  });

  it("rejects using the same column for X and Y", async () => {
    const user = userEvent.setup();

    render(<RegressionView tableName="orders" columns={columns} />);

    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "spend" },
    });
    await user.click(screen.getByRole("button", { name: "Fit model" }));

    expect(screen.getByText("Pick two distinct numeric columns.")).toBeInTheDocument();
  });

  it("fits a linear model and updates the prediction card", async () => {
    const user = userEvent.setup();

    render(<RegressionView tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Fit model" }));

    await waitFor(() => {
      expect(
        screen.getByText("Linear regression fitted on 3 rows."),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Intercept")).toBeInTheDocument();
    expect(screen.getByText("x^1")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("X value for prediction"), {
      target: { value: "5" },
    });

    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getAllByTestId("echart")).toHaveLength(2);
  });

  it("exports the fitted coefficients", async () => {
    const user = userEvent.setup();

    render(<RegressionView tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Fit model" }));

    await waitFor(() => {
      expect(
        screen.getByText("Linear regression fitted on 3 rows."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export coefficients" }));

    expect(mockExportToCSV).toHaveBeenCalledWith(
      [
        { term: "intercept", coefficient: 0 },
        { term: "x^1", coefficient: 2 },
      ],
      "orders-spend-revenue-coefficients.csv",
    );
  });
});
