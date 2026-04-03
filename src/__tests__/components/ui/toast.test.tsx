import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider, useToast } from "@/components/ui/toast";

jest.mock("framer-motion");

function ToastTrigger({ message, type }: { message: string; type?: "success" | "error" | "warning" | "info" }) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast(message, type)}>Show Toast</button>
  );
}

describe("ToastProvider + useToast", () => {
  it("renders a toast when triggered", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastTrigger message="Saved successfully" type="success" />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show Toast"));
    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
  });

  it("renders children without errors", () => {
    render(
      <ToastProvider>
        <p>App content</p>
      </ToastProvider>,
    );

    expect(screen.getByText("App content")).toBeInTheDocument();
  });
});
