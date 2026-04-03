import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Database, Search } from "lucide-react";

import Tabs from "@/components/ui/tabs";

const tabs = [
  { id: "overview", label: "Overview", icon: Database },
  { id: "search", label: "Search", icon: Search },
  { id: "alerts", label: "Alerts" },
];

describe("Tabs", () => {
  it("renders a tablist with the active tab selected", () => {
    render(
      <Tabs tabs={tabs} activeTab="overview" onTabChange={jest.fn()} />,
    );

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Search" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onTabChange when a different tab is clicked", async () => {
    const user = userEvent.setup();
    const onTabChange = jest.fn();

    render(
      <Tabs tabs={tabs} activeTab="overview" onTabChange={onTabChange} />,
    );

    await user.click(screen.getByRole("tab", { name: "Search" }));

    expect(onTabChange).toHaveBeenCalledWith("search");
  });

  it("supports the compact variant styling", () => {
    render(
      <Tabs
        tabs={tabs}
        activeTab="alerts"
        onTabChange={jest.fn()}
        variant="compact"
      />,
    );

    expect(screen.getByRole("tab", { name: "Alerts" })).toHaveClass("px-3", "py-1.5", "text-xs");
  });
});
