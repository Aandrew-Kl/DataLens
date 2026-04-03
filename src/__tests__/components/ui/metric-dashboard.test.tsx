import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import MetricDashboard from "@/components/ui/metric-dashboard";

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockChart() {
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({
  use: jest.fn(),
}));

jest.mock("echarts/charts", () => ({
  LineChart: {},
}));

jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));

jest.mock("echarts/renderers", () => ({
  CanvasRenderer: {},
}));

const metrics = [
  {
    id: "revenue",
    title: "Revenue",
    value: "$42,000",
    trend: { direction: "up" as const, value: "+12%" },
    sparkline: [1, 2, 3, 4],
  },
  {
    id: "churn",
    title: "Churn",
    value: "3.2%",
    trend: { direction: "down" as const, value: "-0.4%" },
    sparkline: [4, 3, 3, 2],
  },
];

async function renderAsync(
  props: Partial<React.ComponentProps<typeof MetricDashboard>> = {},
) {
  await act(async () => {
    render(<MetricDashboard metrics={metrics} {...props} />);
  });
}

describe("MetricDashboard", () => {
  it("renders metric cards with values, trends, and sparklines", async () => {
    await renderAsync();

    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("$42,000")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();
    expect(screen.getAllByTestId("echart")).toHaveLength(2);
  });

  it("runs manual refresh actions", async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    await renderAsync({ onRefresh });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("runs auto-refresh on an interval when enabled", async () => {
    jest.useFakeTimers();
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    await renderAsync({ onRefresh, autoRefreshMs: 1000 });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
