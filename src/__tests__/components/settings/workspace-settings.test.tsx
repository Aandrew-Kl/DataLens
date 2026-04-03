import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WorkspaceSettings from "@/components/settings/workspace-settings";

async function renderAsync() {
  await act(async () => {
    render(<WorkspaceSettings />);
  });
}

describe("WorkspaceSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the default workspace profile when nothing is stored", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Tune workspace defaults for display and performance",
      }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("DataLens workspace")).toBeInTheDocument();
    expect(
      screen.getByText("DataLens workspace · ocean charts · 5,000 max rows"),
    ).toBeInTheDocument();
  });

  it("loads and clamps persisted workspace settings", async () => {
    window.localStorage.setItem(
      "datalens-workspace-settings",
      JSON.stringify({
        workspaceName: "",
        description: "Ops profile",
        chartTheme: "forest",
        dateFormat: "DD/MM/YYYY",
        numberFormat: "currency",
        queryTimeoutSeconds: 1,
        maxRows: 200000,
        cacheTtlMinutes: 0,
      }),
    );

    await renderAsync();

    expect(screen.getByDisplayValue("DataLens workspace")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ops profile")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Default chart theme" }),
    ).toHaveValue("forest");
    expect(
      screen.getByRole("spinbutton", { name: "Query timeout (seconds)" }),
    ).toHaveValue(5);
    expect(
      screen.getByRole("spinbutton", { name: "Max rows per result" }),
    ).toHaveValue(100000);
    expect(
      screen.getByRole("spinbutton", { name: "Cache TTL (minutes)" }),
    ).toHaveValue(1);
  });

  it("saves updated workspace settings to localStorage", async () => {
    const user = userEvent.setup();

    await renderAsync();

    await user.clear(screen.getByRole("textbox", { name: "Workspace name" }));
    await user.type(screen.getByRole("textbox", { name: "Workspace name" }), "Ops Lab");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Default chart theme" }),
      "forest",
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Max rows per result" }), {
      target: { value: "12000" },
    });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(screen.getByText("Workspace settings saved to localStorage.")).toBeInTheDocument();
    expect(screen.getByText("Ops Lab · forest charts · 12,000 max rows")).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("datalens-workspace-settings") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        workspaceName: "Ops Lab",
        chartTheme: "forest",
        maxRows: 12000,
      }),
    );
  });

  it("resets the workspace settings back to defaults", async () => {
    const user = userEvent.setup();

    await renderAsync();

    await user.clear(screen.getByRole("textbox", { name: "Workspace name" }));
    await user.type(screen.getByRole("textbox", { name: "Workspace name" }), "Ops Lab");
    await user.click(screen.getByRole("button", { name: "Reset defaults" }));

    expect(screen.getByDisplayValue("DataLens workspace")).toBeInTheDocument();
    expect(screen.getByText("Workspace settings reset to defaults.")).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("datalens-workspace-settings") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        workspaceName: "DataLens workspace",
        chartTheme: "ocean",
        maxRows: 5000,
      }),
    );
  });
});
