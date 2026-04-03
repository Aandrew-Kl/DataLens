import { render } from "@testing-library/react";

import {
  SkeletonCard,
  SkeletonChart,
  SkeletonLine,
  SkeletonTable,
} from "@/components/ui/skeleton";

describe("Skeleton components", () => {
  it("renders a skeleton line with the provided dimensions", () => {
    const { container } = render(
      <SkeletonLine width="120px" height="18px" className="custom-line" />,
    );

    const line = container.firstElementChild;

    expect(line).toHaveStyle({ width: "120px", height: "18px" });
    expect(line).toHaveClass("custom-line");
  });

  it("renders four placeholder lines inside a skeleton card", () => {
    const { container } = render(<SkeletonCard className="card-shell" />);

    expect(container.firstElementChild).toHaveClass("card-shell");
    expect(container.querySelectorAll("[style]").length).toBe(4);
  });

  it("renders the requested number of table header and body placeholders", () => {
    const { container } = render(
      <SkeletonTable rows={3} columns={2} className="table-shell" />,
    );

    expect(container.firstElementChild).toHaveClass("table-shell");
    expect(container.querySelectorAll("[style]").length).toBe(8);
  });

  it("renders a chart skeleton with placeholder bars and axis labels", () => {
    const { container } = render(<SkeletonChart className="chart-shell" />);

    expect(container.firstElementChild).toHaveClass("chart-shell");
    expect(container.querySelectorAll("[style*=\"height:\"]").length).toBeGreaterThanOrEqual(12);
    expect(container.querySelectorAll("[style*=\"width:\"]").length).toBeGreaterThanOrEqual(8);
  });
});
