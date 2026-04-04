import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider, useToast } from "@/components/ui/toast";

jest.mock("framer-motion");

type ToastType = "success" | "error" | "warning" | "info";

function ToastTrigger({
  message,
  type,
  duration = 10000,
}: {
  message: string;
  type?: ToastType;
  duration?: number;
}) {
  const { toast } = useToast();

  return (
    <button onClick={() => toast(message, type, duration)}>
      Show toast
    </button>
  );
}

describe("ToastProvider", () => {
  it("renders children", () => {
    render(
      <ToastProvider>
        <p>App content</p>
      </ToastProvider>,
    );

    expect(screen.getByText("App content")).toBeInTheDocument();
  });

  it("adds toasts using useToast", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastTrigger message="Saved successfully" type="success" />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show toast"));

    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
  });

  it("renders and dismisses a toast message", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastTrigger message="Please try again" type="error" duration={10000} />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show toast"));
    expect(screen.getByText("Please try again")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.queryByText("Please try again")).not.toBeInTheDocument();
    });
  });
});
