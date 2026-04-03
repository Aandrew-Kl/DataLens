import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Database } from "lucide-react";

import EmptyState from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("renders the icon, title, and description", () => {
    render(
      <EmptyState
        icon={Database}
        title="No datasets"
        description="Upload a CSV to start exploring."
      />,
    );

    expect(screen.getByText("No datasets")).toBeInTheDocument();
    expect(screen.getByText("Upload a CSV to start exploring.")).toBeInTheDocument();
  });

  it("renders the action button when provided", () => {
    render(
      <EmptyState
        icon={Database}
        title="No results"
        description="Try a broader query."
        action={{ label: "Reset filters", onClick: jest.fn() }}
      />,
    );

    expect(screen.getByRole("button", { name: "Reset filters" })).toBeInTheDocument();
  });

  it("calls the action callback when the button is clicked", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();

    render(
      <EmptyState
        icon={Database}
        title="No connections"
        description="Connect a source to continue."
        action={{ label: "Connect source", onClick }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Connect source" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
