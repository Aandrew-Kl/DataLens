import { render, screen } from "@testing-library/react";

import Badge from "@/components/ui/badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Stable</Badge>);

    expect(screen.getByText("Stable")).toBeInTheDocument();
  });

  it("applies the selected variant classes", () => {
    render(<Badge variant="success">Ready</Badge>);

    expect(screen.getByText("Ready")).toHaveClass("bg-emerald-50", "text-emerald-700");
  });

  it("applies the selected size classes", () => {
    render(<Badge size="sm">Small</Badge>);

    expect(screen.getByText("Small")).toHaveClass("px-2", "py-0.5", "text-xs");
  });

  it("supports non-default variants like danger and purple", () => {
    const { rerender } = render(<Badge variant="danger">Critical</Badge>);

    expect(screen.getByText("Critical")).toHaveClass("bg-red-50", "text-red-700");

    rerender(<Badge variant="purple">Custom</Badge>);

    expect(screen.getByText("Custom")).toHaveClass("bg-purple-50", "text-purple-700");
  });
});
