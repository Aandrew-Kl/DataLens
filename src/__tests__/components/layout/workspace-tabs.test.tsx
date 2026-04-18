import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SVGProps } from "react";

import WorkspaceTabs from "@/components/layout/workspace-tabs";

function TestIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" {...props}>
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

const tabs = [
  { id: "overview", label: "Overview", icon: TestIcon, badge: 2 },
  { id: "sql", label: "SQL", icon: TestIcon },
  { id: "charts", label: "Charts", icon: TestIcon, badge: 5 },
  { id: "alerts", label: "Alerts", icon: TestIcon },
];

describe("WorkspaceTabs", () => {
  it("renders tabs with badges and changes tabs on click", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <WorkspaceTabs tabs={tabs} activeTab="overview" onChange={onChange} />,
    );

    expect(screen.getByRole("tab", { name: "Overview 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "Charts 5" }));

    expect(onChange).toHaveBeenCalledWith("charts");
  });

  it("supports keyboard navigation with arrows, home, and end", () => {
    const onChange = jest.fn();

    render(<WorkspaceTabs tabs={tabs} activeTab="sql" onChange={onChange} />);

    const wrapper = screen.getByRole("tablist");

    if (!(wrapper instanceof HTMLElement)) {
      throw new Error("Workspace tabs wrapper was not rendered.");
    }

    fireEvent.keyDown(wrapper, { key: "ArrowRight" });
    fireEvent.keyDown(wrapper, { key: "Home" });
    fireEvent.keyDown(wrapper, { key: "End" });

    expect(onChange).toHaveBeenNthCalledWith(1, "charts");
    expect(onChange).toHaveBeenNthCalledWith(2, "overview");
    expect(onChange).toHaveBeenNthCalledWith(3, "alerts");
  });

  it("shows hidden tabs in the overflow menu and lets the user select them", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const { container } = render(
      <WorkspaceTabs tabs={tabs} activeTab="overview" onChange={onChange} />,
    );

    const scrollContainer = container.querySelector(".overflow-x-auto");
    const tabButtons = screen.getAllByRole("tab");

    if (!(scrollContainer instanceof HTMLDivElement)) {
      throw new Error("Workspace tab scroll container was not rendered.");
    }

    Object.defineProperty(scrollContainer, "clientWidth", {
      configurable: true,
      value: 180,
    });

    tabButtons.forEach((button, index) => {
      Object.defineProperty(button, "offsetLeft", {
        configurable: true,
        value: index * 96,
      });
      Object.defineProperty(button, "offsetWidth", {
        configurable: true,
        value: 90,
      });
    });

    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open overflow tabs" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open overflow tabs" }));
    await user.click(screen.getByRole("menuitem", { name: "Alerts" }));

    expect(onChange).toHaveBeenCalledWith("alerts");
  });
});
