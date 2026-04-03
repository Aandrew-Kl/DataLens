import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SettingsPanel from "@/components/settings/settings-panel";

describe("SettingsPanel", () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("dark"),
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    });

    originalFetch = globalThis.fetch;
    const successResponse = { ok: true } as Response;
    fetchMock = jest.fn().mockResolvedValue(
      successResponse,
    ) as jest.MockedFunction<typeof fetch>;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it("does not render when closed", () => {
    render(<SettingsPanel open={false} onClose={jest.fn()} />);

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("loads persisted settings when the panel opens", () => {
    window.localStorage.setItem("datalens-ollama-url", "http://remote-host:11434");
    window.localStorage.setItem("datalens-ollama-model", "mistral");
    window.localStorage.setItem("datalens-theme", "dark");
    window.localStorage.setItem("datalens-compact", "true");
    window.localStorage.setItem("datalens-page-size", "50");

    const { rerender } = render(
      <SettingsPanel open={false} onClose={jest.fn()} />,
    );

    rerender(<SettingsPanel open onClose={jest.fn()} />);

    expect(screen.getByDisplayValue("http://remote-host:11434")).toBeInTheDocument();
    expect(screen.getByDisplayValue("mistral")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Compact mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getAllByRole("button", { name: "50" })[0]).toBeInTheDocument();
  });

  it("tests the Ollama connection and shows the connected state", async () => {
    const user = userEvent.setup();

    render(<SettingsPanel open onClose={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /Test Connection/i }));

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434", {
      method: "GET",
    });
  });

  it("persists appearance and data settings updates", async () => {
    const user = userEvent.setup();

    render(<SettingsPanel open onClose={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Dark" }));
    await user.click(screen.getByRole("switch", { name: "Compact mode" }));
    await user.click(screen.getAllByRole("button", { name: "50" })[0]);

    expect(window.localStorage.getItem("datalens-theme")).toBe("dark");
    expect(window.localStorage.getItem("datalens-compact")).toBe("true");
    expect(window.localStorage.getItem("datalens-page-size")).toBe("50");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("closes from Escape and the close button", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(<SettingsPanel open onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
