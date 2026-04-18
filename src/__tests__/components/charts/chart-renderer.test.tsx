import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChartRenderer from "@/components/charts/chart-renderer";
import type { ChartConfig } from "@/types/chart";

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
      return React.createElement("div", {
        ref,
        "data-testid": "echart",
        "data-option": JSON.stringify(props.option ?? null),
      });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));

function getOption(): Record<string, unknown> {
  const raw = screen.getByTestId("echart").getAttribute("data-option");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const groupedConfig: ChartConfig = {
  id: "chart-1",
  type: "bar",
  title: "Revenue by Region",
  xAxis: "region",
  yAxis: "revenue",
  groupBy: "segment",
};

const groupedData: Record<string, unknown>[] = [
  { region: "East", revenue: 120, segment: "Retail" },
  { region: "West", revenue: 90, segment: "Retail" },
  { region: "East", revenue: 60, segment: "Enterprise" },
  { region: "West", revenue: 75, segment: "Enterprise" },
];

describe("ChartRenderer", () => {
  it("renders an empty state when no data is available", () => {
    render(<ChartRenderer config={groupedConfig} data={[]} />);

    expect(screen.getByText("No data available for chart")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });

  it("builds grouped bar chart options with a title", async () => {
    render(<ChartRenderer config={groupedConfig} data={groupedData} />);

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    const option = getOption();
    const title = option.title as Record<string, unknown>;
    const legend = option.legend as Record<string, unknown>;
    const series = option.series as Array<Record<string, unknown>>;

    expect(title.text).toBe("Revenue by Region");
    expect(legend.show).toBe(true);
    expect(series).toHaveLength(2);
    expect(series[0]?.type).toBe("bar");
    expect(series.map((entry) => entry.name)).toEqual(["Retail", "Enterprise"]);
  });

  it("renders scatter chart options for numeric x and y axes", async () => {
    const config: ChartConfig = {
      id: "chart-2",
      type: "scatter",
      title: "Sales vs Profit",
      xAxis: "sales",
      yAxis: "profit",
    };

    const data = [
      { sales: 100, profit: 20 },
      { sales: 140, profit: 32 },
    ];

    render(<ChartRenderer config={config} data={data} />);

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<Record<string, unknown>>;
      expect(series[0]?.type).toBe("scatter");
      expect(series[0]?.data).toEqual([
        [100, 20],
        [140, 32],
      ]);
    });
  });

  it("builds histogram bins from numeric values", async () => {
    const config: ChartConfig = {
      id: "chart-3",
      type: "histogram",
      title: "Distribution",
      yAxis: "value",
    };

    const data = [
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 8 },
      { value: 9 },
    ];

    render(<ChartRenderer config={config} data={data} />);

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<Record<string, unknown>>;
      const xAxis = option.xAxis as Record<string, unknown>;
      expect(series[0]?.type).toBe("bar");
      expect((series[0]?.data as unknown[]).length).toBeGreaterThan(1);
      expect((xAxis.data as unknown[]).length).toBeGreaterThan(1);
    });
  });

  it("builds pie options and uses the fallback aria label when no title is present", async () => {
    const config: ChartConfig = {
      id: "chart-4",
      type: "pie",
      title: "",
      xAxis: "region",
      yAxis: "revenue",
    };

    render(<ChartRenderer config={config} data={groupedData} />);

    await waitFor(() => {
      const option = getOption();
      const legend = option.legend as Record<string, unknown>;
      const series = option.series as Array<Record<string, unknown>>;

      expect(legend.type).toBe("scroll");
      expect(series[0]?.type).toBe("pie");
      expect(screen.getByRole("img")).toHaveAttribute(
        "aria-label",
        "pie chart (pie chart)",
      );
    });
  });

  it("adds area styling for area charts and omits grouped legends for a single series", async () => {
    const config: ChartConfig = {
      id: "chart-5",
      type: "area",
      title: "Revenue area",
      xAxis: "region",
      yAxis: "revenue",
    };

    render(<ChartRenderer config={config} data={groupedData} />);

    await waitFor(() => {
      const option = getOption();
      const legend = option.legend as Record<string, unknown>;
      const series = option.series as Array<Record<string, unknown>>;

      expect(legend.show).toBe(false);
      expect(series[0]?.type).toBe("line");
      expect(series[0]?.areaStyle).toEqual(
        expect.objectContaining({ opacity: 0.12 }),
      );
    });
  });

  it("falls back to a bar option for heatmap configs while preserving the chart label", async () => {
    const config = {
      id: "chart-6",
      type: "heatmap",
      title: "",
      xAxis: "region",
      yAxis: "revenue",
    } as ChartConfig;

    render(<ChartRenderer config={config} data={groupedData} />);

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<Record<string, unknown>>;

      expect(series[0]?.type).toBe("bar");
      expect(screen.getByRole("img")).toHaveAttribute(
        "aria-label",
        "heatmap chart (heatmap chart)",
      );
    });
  });

  it("reacts to dark mode changes in the rendered option", async () => {
    render(<ChartRenderer config={groupedConfig} data={groupedData} />);

    await waitFor(() => {
      const option = getOption();
      const title = option.title as Record<string, unknown>;
      const textStyle = title.textStyle as Record<string, unknown>;
      expect(textStyle.color).toBe("#27272a");
    });

    document.documentElement.classList.add("dark");
    const user = userEvent.setup();
    await user.click(document.body);

    await waitFor(() => {
      const option = getOption();
      const title = option.title as Record<string, unknown>;
      const textStyle = title.textStyle as Record<string, unknown>;
      expect(textStyle.color).toBe("#e4e4e7");
    });

    document.documentElement.classList.remove("dark");
  });
});
