import { render, screen } from "@testing-library/react";

import GaugeChart from "@/components/charts/gauge-chart";

jest.mock("framer-motion");

jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: function MockChart(props: {
    option?: { series?: Array<{ data?: Array<{ value?: number }> }> };
  }) {
    const value = props.option?.series?.[0]?.data?.[0]?.value;
    return <div data-testid="echart" data-value={value == null ? "" : String(value)} />;
  },
}));

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ GaugeChart: {} }));
jest.mock("echarts/components", () => ({ TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

describe("GaugeChart", () => {
  it("renders the gauge summary and clamps values above the maximum", () => {
    render(<GaugeChart value={140} min={0} max={100} title="CPU load" />);

    expect(screen.getByText("Gauge meter")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CPU load" })).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toHaveAttribute("data-value", "100");
  });

  it("clamps values below the minimum before passing them to the chart", () => {
    render(
      <GaugeChart
        value={-20}
        min={0}
        max={100}
        title="API health"
        thresholds={{ green: 25, yellow: 75, red: 100 }}
      />,
    );

    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toHaveAttribute("data-value", "0");
  });
});
