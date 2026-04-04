import { render, screen } from "@testing-library/react";

import StatCard from "@/components/ui/stat-card";

const chartPropsSpy = jest.fn();

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(props: Record<string, unknown>) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "stat-card-sparkline" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ SVGRenderer: {} }));

describe("StatCard", () => {
  beforeEach(() => {
    chartPropsSpy.mockClear();
  });

  it("renders the statistic title, formatted value, and positive change", () => {
    render(<StatCard title="Active users" value={1250} change={12.4} />);

    expect(screen.getByText("Active users")).toBeInTheDocument();
    expect(screen.getByText("1.3K")).toBeInTheDocument();
    expect(screen.getByText("+12.4%")).toBeInTheDocument();
  });

  it("renders negative change indicators", () => {
    render(<StatCard title="Churn" value="8.1%" change={-2.3} />);

    expect(screen.getByText("-2.3%")).toBeInTheDocument();
  });

  it("renders a sparkline and passes the accent color into the chart option", () => {
    render(
      <StatCard
        title="Pipeline"
        value={420}
        accentColor="#F97316"
        sparklineData={[10, 12, 18, 15]}
      />,
    );

    expect(screen.getByTestId("stat-card-sparkline")).toBeInTheDocument();

    const lastCall = chartPropsSpy.mock.calls.at(-1);
    const props = (lastCall?.[0] ?? {}) as { option?: { series?: Array<{ lineStyle?: { color?: string } }> } };

    expect(props.option?.series?.[0]?.lineStyle?.color).toBe("#F97316");
  });

  it("omits the chart when no sparkline data is provided", () => {
    render(<StatCard title="Latency" value={42} />);

    expect(screen.queryByTestId("stat-card-sparkline")).not.toBeInTheDocument();
  });
});
