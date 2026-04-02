import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChartBuilder, {
  CHART_SAVED_EVENT,
  SAVED_CHARTS_STORAGE_KEY,
} from "@/components/charts/chart-builder";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/components/charts/chart-renderer", () => ({
  __esModule: true,
  default: ({
    config,
    data,
  }: {
    config: { title: string; type: string };
    data: Record<string, unknown>[];
  }) => (
    <div data-testid="chart-renderer">
      <svg data-testid="chart-svg">
        <title>{config.title}</title>
      </svg>
      <span>{config.title}</span>
      <span>{config.type}</span>
      <span>{data.length} rows rendered</span>
    </div>
  ),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const chartColumns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B", "C"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [5, 10, 20],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2, 4],
  },
];

describe("ChartBuilder", () => {
  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: jest.fn(() => "blob:chart"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      writable: true,
      value: jest.fn(() => ({
        scale: jest.fn(),
        fillRect: jest.fn(),
        drawImage: jest.fn(),
      })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      writable: true,
      value: jest.fn(() => "data:image/png;base64,mock"),
    });

    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }

    Object.defineProperty(window, "Image", {
      writable: true,
      value: MockImage,
    });
  });

  beforeEach(() => {
    mockRunQuery.mockReset();
    window.localStorage.clear();
  });

  it("renders a live preview, updates scatter settings, and exports a PNG", async () => {
    const user = userEvent.setup();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("LIMIT 400")) {
        return [
          { sales: 10, profit: 2 },
          { sales: 20, profit: 4 },
        ];
      }

      return [
        { category: "A", sales: 10 },
        { category: "B", sales: 20 },
      ];
    });

    render(<ChartBuilder tableName="orders" columns={chartColumns} />);

    expect(await screen.findByTestId("chart-renderer")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Sum sales by category" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/SELECT "category", sum\("sales"\) AS "sales"/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^scatter\b/i }));
    await user.selectOptions(screen.getByLabelText("Y-axis"), "profit");

    await waitFor(() => {
      expect(screen.getByText(/SELECT "sales", "profit"/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /export png/i }));

    expect(await screen.findByText("PNG export downloaded.")).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("saves chart snapshots to local storage and broadcasts an event", async () => {
    const user = userEvent.setup();
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    mockRunQuery.mockResolvedValue([
      { category: "A", sales: 10 },
      { category: "B", sales: 20 },
    ]);

    render(<ChartBuilder tableName="orders" columns={chartColumns} />);

    expect(await screen.findByTestId("chart-renderer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Chart saved locally and broadcast to the app."),
    ).toBeInTheDocument();
    expect(setItemSpy).toHaveBeenCalledWith(
      SAVED_CHARTS_STORAGE_KEY,
      expect.stringContaining('"tableName":"orders"'),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: CHART_SAVED_EVENT }),
    );

    setItemSpy.mockRestore();
    dispatchSpy.mockRestore();
  });

  it("shows preview query failures from DuckDB", async () => {
    mockRunQuery.mockRejectedValue(new Error("Chart preview failed"));

    render(<ChartBuilder tableName="orders" columns={chartColumns} />);

    expect(await screen.findByText("Preview query failed")).toBeInTheDocument();
    expect(screen.getByText("Chart preview failed")).toBeInTheDocument();
  });

  it("shows the numeric column guard when the dataset cannot build charts", () => {
    const stringOnlyColumns: ColumnProfile[] = [
      {
        name: "category",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["A", "B"],
      },
    ];

    render(<ChartBuilder tableName="orders" columns={stringOnlyColumns} />);

    expect(
      screen.getByText(
        "This dataset has no numeric columns, so the builder cannot produce aggregated charts yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
