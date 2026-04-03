import {
  announceToScreenReader,
  generateAriaLabel,
  getContrastRatio,
  meetsWCAG,
  trapFocus,
} from "@/lib/utils/accessibility";

describe("accessibility utilities", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("creates and reuses a live region for screen reader announcements", () => {
    announceToScreenReader("Data loaded");
    jest.runAllTimers();

    const liveRegion = document.getElementById("datalens-screen-reader-announcer");

    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent("Data loaded");

    announceToScreenReader("Error detected", "assertive");
    jest.runAllTimers();

    const reusedRegion = document.getElementById("datalens-screen-reader-announcer");

    expect(reusedRegion).toBe(liveRegion);
    expect(reusedRegion).toHaveAttribute("aria-live", "assertive");
    expect(reusedRegion).toHaveAttribute("role", "alert");
    expect(reusedRegion).toHaveTextContent("Error detected");
  });

  it("traps focus within the provided container and restores focus on release", () => {
    document.body.innerHTML = `
      <button id="before">Before</button>
      <div id="dialog">
        <button id="first">First</button>
        <button id="last">Last</button>
      </div>
      <button id="after">After</button>
    `;

    const beforeButton = document.getElementById("before");
    const dialog = document.getElementById("dialog");
    const firstButton = document.getElementById("first");
    const lastButton = document.getElementById("last");

    if (
      !(beforeButton instanceof HTMLButtonElement) ||
      !(dialog instanceof HTMLDivElement) ||
      !(firstButton instanceof HTMLButtonElement) ||
      !(lastButton instanceof HTMLButtonElement)
    ) {
      throw new Error("Expected focus trap test elements to exist.");
    }

    beforeButton.focus();

    const { release } = trapFocus(dialog);

    expect(document.activeElement).toBe(firstButton);

    lastButton.focus();
    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(tabEvent);

    expect(document.activeElement).toBe(firstButton);

    firstButton.focus();
    const reverseTabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(reverseTabEvent);

    expect(document.activeElement).toBe(lastButton);

    release();

    expect(document.activeElement).toBe(beforeButton);
  });

  it("calculates color contrast and WCAG conformance", () => {
    expect(getContrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(meetsWCAG("#000000", "#ffffff")).toBe(true);
    expect(meetsWCAG("#000000", "#ffffff", "AAA")).toBe(true);
    expect(meetsWCAG("#777777", "#ffffff")).toBe(false);
    expect(meetsWCAG("#777777", "#ffffff", "AAA")).toBe(false);
  });

  it("generates descriptive aria labels for data tables", () => {
    expect(generateAriaLabel("Orders", 5, 12)).toBe(
      "Orders data table with 5 columns and 12 rows.",
    );
    expect(generateAriaLabel("", 1, 1)).toBe(
      "Data table with 1 column and 1 row.",
    );
  });
});
