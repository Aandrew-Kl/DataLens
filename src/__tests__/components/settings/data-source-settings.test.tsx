import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataSourceSettings from "@/components/settings/data-source-settings";

async function renderAsync() {
  await act(async () => {
    render(<DataSourceSettings />);
  });
}

describe("DataSourceSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the default data source settings", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Configure local data source defaults",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Delimiter" })).toHaveValue(",");
    expect(screen.getByRole("combobox", { name: "Encoding" })).toHaveValue("utf-8");
  });

  it("loads persisted data source preferences from localStorage", async () => {
    window.localStorage.setItem(
      "datalens:data-source-settings",
      JSON.stringify({
        paths: ["/data/orders.csv"],
        delimiter: "|",
        hasHeaderRow: false,
        encoding: "latin1",
      }),
    );

    await renderAsync();

    expect(screen.getByRole("combobox", { name: "Delimiter" })).toHaveValue("|");
    expect(screen.getByRole("combobox", { name: "Encoding" })).toHaveValue("latin1");
    expect(screen.getByText("/data/orders.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Header row" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("adds, validates, and removes data source paths", async () => {
    const user = userEvent.setup();

    await renderAsync();

    fireEvent.change(screen.getByRole("textbox", { name: "New data source path" }), {
      target: { value: "/tmp/orders.csv" },
    });
    await user.click(screen.getByRole("button", { name: "Add path" }));

    expect(screen.getByText("/tmp/orders.csv")).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("datalens:data-source-settings") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        paths: ["/tmp/orders.csv"],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Test connections" }));
    expect(screen.getByText("Connection test passed for 1 data source path(s).")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Remove /tmp/orders.csv"));
    expect(screen.queryByText("/tmp/orders.csv")).not.toBeInTheDocument();
  });
});
