import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GeoChart from "@/components/charts/geo-chart";
import { runQuery } from "@/lib/duckdb/client";
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

jest.mock("echarts", () => ({
  registerMap: jest.fn(),
  getMap: jest.fn(() => undefined),
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

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const countryColumns: ColumnProfile[] = [
  {
    name: "country",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["United States", "Canada"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
];

describe("GeoChart", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("shows the empty state when no geographic columns are detected", () => {
    render(
      <GeoChart
        tableName="orders"
        columns={[
          {
            name: "segment",
            type: "string",
            nullCount: 0,
            uniqueCount: 2,
            sampleValues: ["A", "B"],
          },
        ]}
      />,
    );

    expect(screen.getByText("Geo chart needs location data")).toBeInTheDocument();
  });

  it("loads mapped country points and renders the top locations panel", async () => {
    mockRunQuery.mockResolvedValue([
      { location_name: "United States", metric_value: 12 },
      { location_name: "Canada", metric_value: 8 },
    ]);

    render(<GeoChart tableName="orders" columns={countryColumns} />);

    await waitFor(() => {
      expect(screen.getByText("Region intensity map")).toBeInTheDocument();
      expect(screen.getByText("Top plotted locations")).toBeInTheDocument();
      expect(screen.getByText("United States")).toBeInTheDocument();
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });
  });

  it("updates the aggregation and value column controls", async () => {
    mockRunQuery.mockResolvedValue([
      { location_name: "United States", metric_value: 99 },
    ]);
    const user = userEvent.setup();

    render(<GeoChart tableName="orders" columns={countryColumns} />);

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "SUM");

    await waitFor(() => {
      expect((selects[1] as HTMLSelectElement).value).toBe("SUM");
    });
  });

  it("shows an offline mapping message when locations do not match the reference set", async () => {
    mockRunQuery.mockResolvedValue([
      { location_name: "Atlantis", metric_value: 3 },
    ]);

    render(<GeoChart tableName="orders" columns={countryColumns} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Geographic column detected, but none of the sampled values matched the built-in location reference used by this offline map.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows query errors from DuckDB", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Geo query failed"));

    render(<GeoChart tableName="orders" columns={countryColumns} />);

    await waitFor(() => {
      expect(screen.getByText("Geo query failed")).toBeInTheDocument();
    });
  });
});
