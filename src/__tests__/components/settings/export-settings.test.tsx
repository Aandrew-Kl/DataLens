import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExportSettings from "@/components/settings/export-settings";

async function renderSettings() {
  await act(async () => {
    render(<ExportSettings />);
  });
}

describe("ExportSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads persisted export settings from localStorage", async () => {
    window.localStorage.setItem(
      "datalens:export-settings",
      JSON.stringify({
        format: "json",
        includeHeaders: false,
        dateFormat: "timestamp",
        delimiter: "|",
      }),
    );

    await renderSettings();

    expect(
      screen.getByText("JSON · headers off · timestamp dates"),
    ).toBeInTheDocument();
    expect(screen.getByText(/"created_at": "1775226600000"/i)).toBeInTheDocument();
  });

  it("updates the default format and persists the choice", async () => {
    const user = userEvent.setup();

    await renderSettings();
    await user.click(screen.getByRole("button", { name: /HTML/i }));

    expect(
      screen.getByText("HTML · headers on · iso dates"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("datalens:export-settings")).toContain(
      '"format":"html"',
    );
  });

  it("toggles headers and changes the CSV delimiter", async () => {
    const user = userEvent.setup();

    await renderSettings();
    await user.click(screen.getByRole("button", { name: /Include headers/i }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /CSV delimiter/i }),
      "\\t",
    );

    expect(window.localStorage.getItem("datalens:export-settings")).toContain(
      '"includeHeaders":false',
    );
    expect(window.localStorage.getItem("datalens:export-settings")).toContain(
      '"delimiter":"\\\\t"',
    );
  });

  it("disables delimiter changes for non-CSV formats", async () => {
    const user = userEvent.setup();

    await renderSettings();
    await user.click(screen.getByRole("button", { name: /JSON/i }));

    expect(screen.getByText(/"created_at":/i)).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /CSV delimiter/i }),
    ).toBeDisabled();
  });
});
