import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ErrorPage from "@/app/error";

describe("ErrorPage", () => {
  it("renders error message", () => {
    const error = new Error("Something broke");
    const reset = jest.fn();

    render(<ErrorPage error={error} reset={reset} />);

    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });

  it("calls reset when Try again is clicked", async () => {
    const user = userEvent.setup();
    const error = new Error("Something broke");
    const reset = jest.fn();

    render(<ErrorPage error={error} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
