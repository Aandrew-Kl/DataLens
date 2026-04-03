import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AccessibilityPanel from "@/components/ui/accessibility-panel";

describe("AccessibilityPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.dataset.datalensColorPalette = "";
    document.documentElement.style.removeProperty("--datalens-accessibility-font-scale");
  });

  it("opens the comfort controls panel and closes it again", async () => {
    const user = userEvent.setup();

    render(<AccessibilityPanel />);

    await user.click(
      screen.getByRole("button", { name: "Open accessibility settings" }),
    );

    expect(screen.getByText("Comfort controls")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close accessibility settings" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Comfort controls")).not.toBeInTheDocument();
    });
  });

  it("applies and persists font, contrast, and palette settings", async () => {
    const user = userEvent.setup();

    render(<AccessibilityPanel />);

    await user.click(
      screen.getByRole("button", { name: "Open accessibility settings" }),
    );
    await user.click(screen.getByRole("button", { name: "Large" }));
    await user.click(screen.getByRole("button", { name: /High contrast mode/i }));
    await user.click(screen.getByRole("button", { name: "Deuteranopia" }));

    expect(
      document.documentElement.style.getPropertyValue(
        "--datalens-accessibility-font-scale",
      ),
    ).toBe("1.1");
    expect(document.documentElement.classList.contains("datalens-high-contrast")).toBe(true);
    expect(document.documentElement.dataset.datalensColorPalette).toBe("deuteranopia");
    expect(window.localStorage.getItem("datalens:accessibility")).toContain(
      '"fontSize":"large"',
    );
  });

  it("shows live region hints when screen reader announcements are enabled", async () => {
    const user = userEvent.setup();

    render(<AccessibilityPanel />);

    await user.click(
      screen.getByRole("button", { name: "Open accessibility settings" }),
    );
    await user.click(screen.getByRole("button", { name: /Screen reader hints/i }));

    expect(screen.getByText("Screen reader hints enabled.")).toBeInTheDocument();
    expect(
      screen.getByText("Keyboard navigation help is available from the accessibility panel."),
    ).toBeInTheDocument();
  });

  it("opens keyboard navigation help and Escape closes the overlay and panel", async () => {
    const user = userEvent.setup();

    render(<AccessibilityPanel />);

    await user.click(
      screen.getByRole("button", { name: "Open accessibility settings" }),
    );
    await user.click(screen.getByRole("button", { name: /Keyboard navigation help/i }));

    expect(
      screen.getByRole("dialog", { name: "Keyboard navigation help" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Keyboard navigation help" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Comfort controls")).not.toBeInTheDocument();
    });
  });
});
