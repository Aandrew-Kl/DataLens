import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ResizablePanels from "@/components/ui/resizable-panels";

const panels = [
  {
    id: "filters",
    title: "Filters",
    children: <div>Filters content</div>,
  },
  {
    id: "results",
    title: "Results",
    children: <div>Results content</div>,
  },
];

describe("ResizablePanels", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000,
      writable: true,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
      writable: true,
    });
  });

  it("renders both panels and an interleaved resize divider", () => {
    render(<ResizablePanels panels={panels} />);

    expect(screen.getByText("Filters content")).toBeInTheDocument();
    expect(screen.getByText("Results content")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByTestId("panel-filters")).toHaveStyle({ flexBasis: "50%" });
    expect(screen.getByTestId("panel-results")).toHaveStyle({ flexBasis: "50%" });
  });

  it("collapses and re-expands a panel from its header control", async () => {
    const user = userEvent.setup();

    render(<ResizablePanels panels={panels} />);

    await user.click(screen.getByRole("button", { name: "Collapse Filters panel" }));
    expect(screen.getByText("8% width")).toBeInTheDocument();
    expect(screen.getByText("92% width")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand Filters panel" }));
    expect(screen.getAllByText("50% width")).toHaveLength(2);
  });

  it("supports vertical layouts with height-based labels", () => {
    render(<ResizablePanels panels={panels} direction="vertical" />);

    expect(screen.getAllByText("50% height")).toHaveLength(2);
  });
});
