import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PerformanceSettings from "@/components/settings/performance-settings";

async function renderAsync() {
  await act(async () => {
    render(<PerformanceSettings />);
  });
}

describe("PerformanceSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the default performance profile", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Tune local DuckDB performance budgets",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "DuckDB memory limit" })).toHaveValue("2048");
    expect(
      screen.getByText("2048 MB memory · 4 workers · 512 MB cache"),
    ).toBeInTheDocument();
  });

  it("loads persisted and clamped performance settings", async () => {
    window.localStorage.setItem(
      "datalens:performance-settings",
      JSON.stringify({
        duckDbMemoryLimitMb: 12000,
        workerThreads: 20,
        cacheSizeMb: 9999,
        queryTimeoutSeconds: 1000,
        autoProfileOnLoad: true,
      }),
    );

    await renderAsync();

    expect(screen.getByRole("slider", { name: "DuckDB memory limit" })).toHaveValue("8192");
    expect(screen.getByRole("spinbutton", { name: "Worker threads" })).toHaveValue(16);
    expect(screen.getByRole("spinbutton", { name: "Cache size" })).toHaveValue(4096);
    expect(screen.getByRole("spinbutton", { name: "Query timeout" })).toHaveValue(600);
    expect(screen.getByRole("button", { name: "Auto-profile on load" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("saves updated performance settings to localStorage", async () => {
    const user = userEvent.setup();

    await renderAsync();

    fireEvent.change(screen.getByRole("slider", { name: "DuckDB memory limit" }), {
      target: { value: "3072" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Worker threads" }), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Cache size" }), {
      target: { value: "768" },
    });
    await user.click(screen.getByRole("button", { name: "Auto-profile on load" }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(screen.getByText("Performance settings saved to localStorage.")).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("datalens:performance-settings") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        duckDbMemoryLimitMb: 3072,
        workerThreads: 6,
        cacheSizeMb: 768,
        autoProfileOnLoad: true,
      }),
    );
  });
});
