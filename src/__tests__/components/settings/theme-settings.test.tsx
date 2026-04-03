import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ThemeSettings from "@/components/settings/theme-settings";

async function renderSettings() {
  await act(async () => {
    render(<ThemeSettings />);
  });
}

describe("ThemeSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads saved theme settings from localStorage", async () => {
    window.localStorage.setItem(
      "datalens:theme-settings",
      JSON.stringify({
        theme: "dark",
        accent: "rose",
        fontSize: 18,
        compactMode: true,
      }),
    );

    await renderSettings();

    expect(screen.getByText("dark · rose · 18px")).toBeInTheDocument();
    expect(
      screen.getByText("Compact spacing keeps more information visible."),
    ).toBeInTheDocument();
  });

  it("persists theme mode changes", async () => {
    const user = userEvent.setup();

    await renderSettings();
    await user.click(screen.getByRole("button", { name: /Dark/i }));

    expect(window.localStorage.getItem("datalens:theme-settings")).toContain(
      '"theme":"dark"',
    );
  });

  it("updates accent and font size", async () => {
    const user = userEvent.setup();

    await renderSettings();
    await user.click(screen.getByRole("button", { name: /Amber/i }));
    fireEvent.change(screen.getByRole("slider"), {
      target: { value: "19" },
    });

    expect(window.localStorage.getItem("datalens:theme-settings")).toContain(
      '"accent":"amber"',
    );
    expect(window.localStorage.getItem("datalens:theme-settings")).toContain(
      '"fontSize":19',
    );
    expect(screen.getByText("system · amber · 19px")).toBeInTheDocument();
  });

  it("toggles compact mode and updates the preview copy", async () => {
    const user = userEvent.setup();

    await renderSettings();
    await user.click(screen.getByRole("button", { name: /Compact mode/i }));

    expect(
      screen.getByText("Compact spacing keeps more information visible."),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("datalens:theme-settings")).toContain(
      '"compactMode":true',
    );
  });
});
