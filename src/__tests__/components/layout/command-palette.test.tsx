import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CommandPalette from "@/components/layout/command-palette";

describe("CommandPalette", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("does not render when closed", () => {
    render(
      <CommandPalette open={false} onClose={jest.fn()} onAction={jest.fn()} />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders recent commands after opening and hides them while searching", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "datalens-recent-commands",
      JSON.stringify(["export-json", "view-github"]),
    );

    const { rerender } = render(
      <CommandPalette open={false} onClose={jest.fn()} onAction={jest.fn()} />,
    );

    rerender(<CommandPalette open onClose={jest.fn()} onAction={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
      expect(screen.getByText("Recent")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Type a command..."), "github");

    await waitFor(() => {
      expect(screen.queryByText("Recent")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /View on GitHub/ })).toBeInTheDocument();
    });
  });

  it("executes a clicked command, stores it as recent, and closes", async () => {
    const user = userEvent.setup();
    const onAction = jest.fn();
    const onClose = jest.fn();

    render(<CommandPalette open onClose={onClose} onAction={onAction} />);

    fireEvent.change(screen.getByPlaceholderText("Type a command..."), {
      target: { value: "github" },
    });
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith("view-github");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(
      JSON.parse(window.localStorage.getItem("datalens-recent-commands") ?? "[]"),
    ).toEqual(["view-github"]);
  });

  it("supports keyboard navigation with enter to run the selected command", async () => {
    const user = userEvent.setup();
    void user;

    const onAction = jest.fn();

    render(<CommandPalette open onClose={jest.fn()} onAction={onAction} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith("export-csv");
    });
  });

  it("closes on escape and shows an empty-state message for no matches", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(<CommandPalette open onClose={onClose} onAction={jest.fn()} />);

    await user.type(screen.getByPlaceholderText("Type a command..."), "zzzz");

    await waitFor(() => {
      expect(screen.getByText("No matching commands")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
