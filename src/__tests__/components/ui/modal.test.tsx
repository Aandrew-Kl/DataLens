import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Modal from "@/components/ui/modal";

describe("Modal", () => {
  it("does not render a dialog when closed", () => {
    render(
      <Modal open={false} onClose={jest.fn()} title="Settings">
        <button type="button">Save</button>
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog, traps body scrolling, and focuses the first focusable element", async () => {
    render(
      <Modal open onClose={jest.fn()} title="Settings">
        <button type="button">Save</button>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();
    });
  });

  it("closes from the close button, backdrop, and Escape key", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(
      <Modal open onClose={onClose} title="Filters">
        <button type="button">Apply</button>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Close modal" }));

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    const backdrop = dialog.previousElementSibling;

    if (!(backdrop instanceof HTMLElement)) {
      throw new Error("Modal backdrop was not rendered.");
    }

    fireEvent.click(backdrop);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("restores body scrolling when the modal closes", () => {
    const { rerender } = render(
      <Modal open onClose={jest.fn()} title="Export">
        <div>Body</div>
      </Modal>,
    );

    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Modal open={false} onClose={jest.fn()} title="Export">
        <div>Body</div>
      </Modal>,
    );

    expect(document.body.style.overflow).toBe("");
  });
});
