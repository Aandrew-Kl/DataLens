/**
 * Accessibility smoke tests using jest-axe.
 *
 * Covers high-traffic UI primitives to catch the most common WCAG issues
 * (missing alt text, label associations, contrast hints, ARIA misuse).
 *
 * If a rule fires and the fix is non-trivial, prefer documenting the
 * violation and adding a targeted jest.skip rather than disabling axe.
 */
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { Sparkles } from "lucide-react";

import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";
import LoadingOverlay from "@/components/ui/loading-overlay";
import {
  SkeletonCard,
  SkeletonChart,
  SkeletonLine,
  SkeletonTable,
} from "@/components/ui/skeleton";

expect.extend(toHaveNoViolations);

// Mock echarts — jsdom cannot parse the ESM charts.js export.
jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart() {
      return React.createElement("div", { "data-testid": "mock-echarts" });
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

describe("a11y smoke tests", () => {
  it("Badge has no a11y violations", async () => {
    const { container } = render(<Badge variant="info">Live</Badge>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("EmptyState has no a11y violations", async () => {
    const { container } = render(
      <EmptyState
        icon={Sparkles}
        title="No datasets yet"
        description="Upload a CSV to get started."
        action={{ label: "Upload", onClick: () => undefined }}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("StatCard has no a11y violations", async () => {
    const { container } = render(
      <StatCard
        title="Active users"
        value={1234}
        change={0.12}
        sparklineData={[1, 2, 3, 4, 5]}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("LoadingOverlay (visible) has no a11y violations", async () => {
    const { container } = render(
      <LoadingOverlay visible message="Processing" progress={50} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("SkeletonLine has no a11y violations", async () => {
    const { container } = render(<SkeletonLine width="100px" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("SkeletonCard has no a11y violations", async () => {
    const { container } = render(<SkeletonCard />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("SkeletonTable has no a11y violations", async () => {
    const { container } = render(<SkeletonTable rows={3} columns={3} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("SkeletonChart has no a11y violations", async () => {
    const { container } = render(<SkeletonChart />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
