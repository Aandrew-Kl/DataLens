import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import KeyboardShortcutsDialog from "@/components/ui/keyboard-shortcuts-dialog";

jest.mock("framer-motion");

describe("KeyboardShortcutsDialog", () => {
  const originalPlatform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: originalPlatform,
    });
    document.body.style.overflow = "";
  });

  it("does not render the dialog while closed", () => {
    render(<KeyboardShortcutsDialog open={false} onClose={jest.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders grouped shortcuts and focuses the close button when opened", async () => {
    render(<KeyboardShortcutsDialog open onClose={jest.fn()} />);

    expect(
      screen.getByRole("dialog", {
        name: "Work faster without leaving the keyboard",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Data")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Close dialog" }),
      ).toHaveFocus();
    });
  });

  it("uses macOS modifier labels when the platform is Mac", () => {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });

    render(<KeyboardShortcutsDialog open onClose={jest.fn()} />);

    expect(
      screen.getByText("Displayed for macOS users with the correct modifier labels."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Cmd").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ctrl")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores body scrolling", async () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <KeyboardShortcutsDialog open onClose={onClose} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<KeyboardShortcutsDialog open={false} onClose={onClose} />);

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("");
    });
  });

  it("closes when the backdrop or close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(<KeyboardShortcutsDialog open onClose={onClose} />);

    await user.click(
      screen.getByRole("button", { name: "Close keyboard shortcuts dialog" }),
    );
    await user.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
