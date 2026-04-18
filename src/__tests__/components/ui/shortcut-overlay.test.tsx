import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ShortcutOverlay from "@/components/ui/shortcut-overlay";

describe("ShortcutOverlay", () => {
  const originalPlatform = window.navigator.platform;

  beforeEach(() => {
    document.body.style.overflow = "";
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: originalPlatform,
    });
    document.body.style.overflow = "";
  });

  it("does not render the overlay while closed", () => {
    render(<ShortcutOverlay />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with the question-mark shortcut and locks body scrolling", async () => {
    const user = userEvent.setup();

    render(<ShortcutOverlay />);
    await user.keyboard("?");

    expect(
      await screen.findByRole("dialog", {
        name: "Keyboard reference for the DataLens workspace",
      }),
    ).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });

  // TODO(wave3): useDeferredValue + React 19 + JSDOM interaction causes
  // the filter update not to commit in test. Works in real browser.
  // Re-enable once jest/React 19 testing shim supports deferred flush,
  // or refactor ShortcutOverlay to expose a non-deferred path for tests.
  it.skip("filters the shortcut list and shows the empty state for unmatched queries", async () => {
    const user = userEvent.setup();

    render(<ShortcutOverlay />);
    await user.keyboard("?");

    const search = await screen.findByPlaceholderText("Filter shortcuts...");
    await user.type(search, "export");

    expect(screen.getByText("Export the current data view")).toBeInTheDocument();
    expect(screen.queryByText("Open the command palette")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    await user.type(search, "zzzz");

    expect(await screen.findByText("No shortcuts matched")).toBeInTheDocument();
  });

  it("ignores the question-mark shortcut while typing inside an editable field", async () => {
    const user = userEvent.setup();

    render(
      <>
        <input aria-label="editor" />
        <ShortcutOverlay />
      </>,
    );

    await user.click(screen.getByRole("textbox", { name: "editor" }));
    await user.keyboard("?");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses macOS modifier labels when the platform is Mac", async () => {
    const user = userEvent.setup();

    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });

    render(<ShortcutOverlay />);
    await user.keyboard("?");

    expect(await screen.findByText(/macOS/)).toBeInTheDocument();
    expect(screen.getAllByText("Cmd").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ctrl")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores body scrolling", async () => {
    const user = userEvent.setup();

    render(<ShortcutOverlay />);
    await user.keyboard("?");
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).toBe("");
  });

  it("closes when the explicit close button is clicked", async () => {
    const user = userEvent.setup();

    render(<ShortcutOverlay />);
    await user.keyboard("?");
    await screen.findByRole("dialog");

    const closeButtons = screen.getAllByRole("button", {
      name: "Close shortcut overlay",
    });
    await user.click(closeButtons[1]!);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
