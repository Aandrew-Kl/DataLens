import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SearchInput from "@/components/ui/search-input";

describe("SearchInput", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls onChange immediately when debounce is disabled", () => {
    const onChange = jest.fn();

    render(<SearchInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "revenue" },
    });

    expect(onChange).toHaveBeenCalledWith("revenue");
  });

  it("debounces updates when debounceMs is provided", async () => {
    jest.useFakeTimers();
    const onChange = jest.fn();

    render(<SearchInput value="" onChange={onChange} debounceMs={300} />);

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "orders" },
    });

    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(300);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("orders");
    });
  });

  it("syncs when the external value changes", () => {
    const { rerender } = render(
      <SearchInput value="old query" onChange={jest.fn()} />,
    );

    rerender(<SearchInput value="new query" onChange={jest.fn()} />);

    expect(screen.getByDisplayValue("new query")).toBeInTheDocument();
  });

  it("clears the input and runs onClear", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onClear = jest.fn();

    render(
      <SearchInput
        value="customers"
        onChange={onChange}
        onClear={onClear}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onChange).toHaveBeenCalledWith("");
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
