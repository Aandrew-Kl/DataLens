import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Breadcrumb from "@/components/layout/breadcrumb";

describe("Breadcrumb", () => {
  it("renders nothing when there are no breadcrumb items", () => {
    render(<Breadcrumb items={[]} />);

    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });

  it("renders clickable ancestors and a current page", async () => {
    const user = userEvent.setup();
    const onHomeClick = jest.fn();

    render(
      <Breadcrumb
        items={[
          { label: "Home", onClick: onHomeClick },
          { label: "Datasets", onClick: jest.fn() },
          { label: "Sales" },
        ]}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByText("Sales").closest("[aria-current='page']")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Home" }));

    expect(onHomeClick).toHaveBeenCalledTimes(1);
  });

  it("renders non-clickable intermediate items as text instead of buttons", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Home", onClick: jest.fn() },
          { label: "Static section" },
          { label: "Leaf" },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Static section" })).not.toBeInTheDocument();
    expect(screen.getByText("Static section")).toBeInTheDocument();
  });
});
