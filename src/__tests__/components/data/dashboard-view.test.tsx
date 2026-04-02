import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import DashboardView from "@/components/data/dashboard-view";
import { runQuery } from "@/lib/duckdb/client";
import type { ChartConfig } from "@/types/chart";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/components/charts/chart-renderer", () => ({
  __esModule: true,
  default: ({
    config,
    data,
  }: {
    config: ChartConfig;
    data: Record<string, unknown>[];
  }) => (
    <div data-testid={`chart-renderer-${config.title}`}>
      {config.title}:{data.length}
    </div>
  ),
}));

jest.mock("@/components/ui/modal", () => ({
  __esModule: true,
  default: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title?: string;
    children: ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {title ? <h2>{title}</h2> : null}
        {children}
      </div>
    ) : null,
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockFetch = jest.fn();

const mockColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200, 300],
    min: 100,
    max: 300,
    mean: 200,
    median: 200,
  },
  {
    name: "status",
    type: "string",
    nullCount: 50,
    uniqueCount: 1,
    sampleValues: ["active"],
  },
];

const mockDataset: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "sales data.csv",
  rowCount: 100,
  columnCount: mockColumns.length,
  columns: mockColumns,
  uploadedAt: 1,
  sizeBytes: 1024,
};

const mockDashboardResponse = {
  metrics: [
    {
      label: "Total Revenue",
      value: 1200,
      emoji: "$",
      change: "+10%",
    },
  ],
  charts: [
    {
      id: "chart-1",
      type: "bar" as const,
      title: "Revenue by Region",
      xAxis: "region",
      yAxis: "revenue",
      aggregation: "sum" as const,
    },
  ],
};

describe("DashboardView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockDashboardResponse,
    } as Response);

    mockRunQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT "region", sum("revenue") AS value')) {
        return [
          { region: "East", value: 600 },
          { region: "West", value: 400 },
        ];
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });

  it("renders a generated dashboard with metrics, charts, and quality hints", async () => {
    render(<DashboardView dataset={mockDataset} columns={mockColumns} />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ai/suggest",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(screen.getByText("Total Revenue")).toBeInTheDocument();
    expect(screen.getByTestId("chart-renderer-Revenue by Region")).toHaveTextContent(
      "Revenue by Region:2",
    );
    expect(screen.getByText("Columns with issues")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
  });

  it("removes a chart from the dashboard", async () => {
    render(<DashboardView dataset={mockDataset} columns={mockColumns} />);

    await screen.findByTestId("chart-renderer-Revenue by Region");
    fireEvent.click(screen.getByLabelText(/remove chart/i));

    await waitFor(() =>
      expect(
        screen.queryByTestId("chart-renderer-Revenue by Region"),
      ).not.toBeInTheDocument(),
    );
  });

  it("previews and adds a custom chart", async () => {
    render(<DashboardView dataset={mockDataset} columns={mockColumns} />);

    await screen.findByRole("heading", { name: "Dashboard" });
    fireEvent.click(screen.getByRole("button", { name: /add chart/i }));

    expect(
      screen.getByRole("dialog", { name: /add custom chart/i }),
    ).toBeInTheDocument();

    const dialog = screen.getByRole("dialog", { name: /add custom chart/i });
    const [xAxisSelect, yAxisSelect, aggregationSelect, groupBySelect] =
      within(dialog).getAllByRole("combobox");

    fireEvent.change(
      within(dialog).getByPlaceholderText("Auto-generated if empty"),
      {
        target: { value: "Custom Revenue" },
      },
    );
    fireEvent.change(xAxisSelect, {
      target: { value: "region" },
    });
    fireEvent.change(yAxisSelect, {
      target: { value: "revenue" },
    });
    fireEvent.change(aggregationSelect, {
      target: { value: "sum" },
    });
    fireEvent.change(groupBySelect, {
      target: { value: "" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /preview/i }));

    await waitFor(() =>
      expect(within(dialog).getByTestId("chart-renderer-Custom Revenue")).toHaveTextContent(
        "Custom Revenue:2",
      ),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: /add to dashboard/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /add custom chart/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("chart-renderer-Custom Revenue")).toBeInTheDocument();
  });
});
