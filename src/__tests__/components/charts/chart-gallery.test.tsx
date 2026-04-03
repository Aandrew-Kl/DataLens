import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChartGallery from "@/components/charts/chart-gallery";
import { runQuery } from "@/lib/duckdb/client";
import type { ChartConfig } from "@/types/chart";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("echarts-for-react", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<HTMLDivElement>,
    ) {
      return React.createElement("div", { ref, "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));

jest.mock("@/components/charts/chart-renderer", () => ({
  __esModule: true,
  default: ({
    config,
    data,
  }: {
    config: { title: string; type: string };
    data: Record<string, unknown>[];
  }) => <div data-testid="chart-renderer">{`${config.title}:${config.type}:${data.length}`}</div>,
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["East", "West"],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Retail", "Enterprise"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [20, 40],
  },
  {
    name: "order_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["2024-01-01", "2024-01-02"],
  },
];

const legacyCharts: ChartConfig[] = [
  {
    id: "chart-1",
    type: "bar",
    title: "Sales by Region",
    xAxis: "region",
    yAxis: "sales",
  },
];

describe("ChartGallery", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([
      {
        region: "East",
        segment: "Retail",
        sales: 100,
        profit: 20,
        order_date: "2024-01-01",
      },
    ]);
  });

  it("renders the showcase gallery and loads preview rows", async () => {
    render(<ChartGallery tableName="orders" columns={columns} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Preview every chart style before you commit",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Recommended").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM "orders" LIMIT 120'),
      );
    });
  });

  it("filters chart cards with the search input", async () => {
    const user = userEvent.setup();

    render(<ChartGallery tableName="orders" columns={columns} />);

    await user.type(screen.getByPlaceholderText("Find chart types"), "rad");

    expect(screen.getByText("Radar")).toBeInTheDocument();
    expect(screen.queryByText("Scatter")).not.toBeInTheDocument();
  });

  it("calls onSelect when a showcase card is chosen", async () => {
    const onSelect = jest.fn();

    render(<ChartGallery tableName="orders" columns={columns} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Scatter"));

    expect(onSelect).toHaveBeenCalledWith("scatter");
  });

  it("renders the legacy empty state when no charts are saved", () => {
    render(
      <ChartGallery
        charts={[]}
        chartData={{}}
        onEdit={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    expect(screen.getByText("No saved charts yet")).toBeInTheDocument();
  });

  it("renders legacy cards and forwards edit and remove actions", async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    const onRemove = jest.fn();

    render(
      <ChartGallery
        charts={legacyCharts}
        chartData={{ "chart-1": [{ region: "East", sales: 100 }] }}
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByTestId("chart-renderer")).toHaveTextContent(
      "Sales by Region:bar:1",
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(onEdit).toHaveBeenCalledWith(legacyCharts[0]);
    expect(onRemove).toHaveBeenCalledWith("chart-1");
  });
});
