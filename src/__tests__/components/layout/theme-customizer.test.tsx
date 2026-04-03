import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ThemeCustomizer from "@/components/layout/theme-customizer";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

function getToggleButton(label: string): HTMLButtonElement {
  const row = screen.getByText(label).parentElement?.parentElement;
  const toggle = row?.querySelector("button");

  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error(`Toggle button for ${label} was not rendered.`);
  }

  return toggle;
}

describe("ThemeCustomizer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    });
  });

  it("renders the theme controls and preview panel", () => {
    const user = userEvent.setup();

    render(<ThemeCustomizer />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Tune DataLens visuals and persist them locally",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Preview panel")).toBeInTheDocument();

    void user;
  });

  it("switches presets and persists the accent color", async () => {
    const user = userEvent.setup();

    render(<ThemeCustomizer />);

    await user.click(screen.getByRole("button", { name: /Forest/i }));

    expect(screen.getAllByText("#15803d")).toHaveLength(2);
    expect(window.localStorage.getItem("datalens:theme")).toContain('"preset":"Forest"');
  });

  it("updates compact mode and dark mode datasets on the document element", async () => {
    const user = userEvent.setup();

    render(<ThemeCustomizer />);

    await user.click(screen.getByRole("button", { name: "Dark" }));
    await user.click(getToggleButton("Compact mode"));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.datalensCompact).toBe("1");
  });

  it("exports the current theme as JSON", async () => {
    const user = userEvent.setup();
    const anchorClick = jest.fn();
    const createElementSpy = jest
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string) => {
        const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
        if (tagName === "a") {
          Object.defineProperty(element, "click", {
            value: anchorClick,
          });
        }
        return element as HTMLElement;
      });

    render(<ThemeCustomizer />);

    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(anchorClick).toHaveBeenCalled();
    expect(screen.getByText("Theme exported as JSON.")).toBeInTheDocument();

    createElementSpy.mockRestore();
  });

  it("imports a JSON theme file", async () => {
    const user = userEvent.setup();
    const json = JSON.stringify({
      preset: "Monochrome",
      accentColor: "#475569",
      mode: "dark",
      compactMode: true,
    });

    const { container } = render(<ThemeCustomizer />);
    const fileInput = container.querySelector('input[type="file"]');

    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Theme import input was not rendered.");
    }

    const file = new File([json], "theme.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: jest.fn().mockResolvedValue(json),
    });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText("Theme imported from JSON.")).toBeInTheDocument();
    });

    expect(screen.getAllByText("#475569")).toHaveLength(2);
    expect(document.documentElement.dataset.datalensCompact).toBe("1");
  });
});
