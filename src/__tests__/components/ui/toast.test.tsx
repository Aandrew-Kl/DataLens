import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider, useToast } from "@/components/ui/toast";

function ToastHarness() {
  const { toast } = useToast();

  return (
    <div>
      <button
        type="button"
        onClick={() => toast("Saved changes", "success", 3000)}
      >
        Show success
      </button>
      <button
        type="button"
        onClick={() => toast("Network issue", "error", 3000)}
      >
        Show error
      </button>
      <button
        type="button"
        onClick={() => toast("Another item", "info", 3000)}
      >
        Show info
      </button>
      <button
        type="button"
        onClick={() => toast("Last item", "warning", 3000)}
      >
        Show warning
      </button>
    </div>
  );
}

describe("Toast", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("throws when useToast is used outside the provider", () => {
    expect(() => render(<ToastHarness />)).toThrow(
      "useToast must be used within a ToastProvider",
    );
  });

  it("renders and dismisses a toast from the provider", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Show success" }));

    expect(screen.getByText("Saved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.queryByText("Saved changes")).not.toBeInTheDocument();
    });
  });

  it("keeps only the latest three toasts visible", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Show success" }));
    await user.click(screen.getByRole("button", { name: "Show error" }));
    await user.click(screen.getByRole("button", { name: "Show info" }));
    await user.click(screen.getByRole("button", { name: "Show warning" }));

    expect(screen.queryByText("Saved changes")).not.toBeInTheDocument();
    expect(screen.getByText("Network issue")).toBeInTheDocument();
    expect(screen.getByText("Another item")).toBeInTheDocument();
    expect(screen.getByText("Last item")).toBeInTheDocument();
  });

  it("auto-dismisses a toast after its duration", async () => {
    jest.useFakeTimers();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show error" }));

    expect(screen.getByText("Network issue")).toBeInTheDocument();

    jest.advanceTimersByTime(3000);

    await waitFor(() => {
      expect(screen.queryByText("Network issue")).not.toBeInTheDocument();
    });
  });
});
