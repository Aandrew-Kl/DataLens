import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DateRangePicker from "@/components/ui/date-range-picker";

const TODAY = new Date("2026-04-03T12:00:00.000Z");

describe("DateRangePicker", () => {
  it("renders the default trigger label", () => {
    render(<DateRangePicker today={TODAY} />);

    expect(screen.getByRole("button", { name: "Select date range" })).toBeInTheDocument();
  });

  it("applies a quick preset and updates the trigger label", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(<DateRangePicker today={TODAY} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Select date range" }));
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));

    expect(onChange).toHaveBeenLastCalledWith({
      start: "2026-03-28",
      end: "2026-04-03",
    });
    expect(
      screen.getByRole("button", { name: "Mar 28, 2026 - Apr 3, 2026 Active" }),
    ).toBeInTheDocument();
  });

  it("normalizes custom ranges before applying them", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(<DateRangePicker today={TODAY} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Select date range" }));
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-04-10" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-04-02" },
    });
    await user.click(screen.getByRole("button", { name: "Apply custom range" }));

    expect(onChange).toHaveBeenLastCalledWith({
      start: "2026-04-02",
      end: "2026-04-10",
    });
    expect(
      screen.getByRole("button", { name: "Apr 2, 2026 - Apr 10, 2026 Active" }),
    ).toBeInTheDocument();
  });

  it("clears the current range from the popover", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <DateRangePicker
        today={TODAY}
        onChange={onChange}
        defaultValue={{ start: "2026-04-01", end: "2026-04-03" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Apr 1, 2026 - Apr 3, 2026 Active" }));
    await user.click(screen.getByRole("button", { name: "Clear range" }));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "Select date range" })).toBeInTheDocument();
  });
});
