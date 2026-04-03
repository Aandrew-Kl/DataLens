import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import CommandBar, { type Command } from "@/components/ui/command-bar";

jest.mock("framer-motion");

const commands: Command[] = [
  {
    id: "export-csv",
    label: "Export CSV",
    category: "Export",
    description: "Download the current result set as CSV",
    keywords: ["download", "csv"],
    shortcut: "Shift+E",
  },
  {
    id: "open-orders",
    label: "Open orders dataset",
    category: "Data",
    description: "Focus the uploaded orders table",
    keywords: ["orders", "dataset"],
  },
  {
    id: "build-chart",
    label: "Build revenue chart",
    category: "Chart",
    description: "Open the chart builder for revenue metrics",
    keywords: ["visualize", "revenue"],
  },
];

describe("CommandBar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens from the keyboard, filters commands, and executes the current match", async () => {
    const onExecute = jest.fn();

    render(<CommandBar commands={commands} onExecute={onExecute} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await waitFor(() =>
      screen.getByPlaceholderText("Search commands, actions, datasets, charts..."),
    );

    fireEvent.change(input, { target: { value: "visualize" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Build revenue chart/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Build revenue chart/i }));

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith(commands[2]);
    });

    expect(
      JSON.parse(window.localStorage.getItem("datalens:command-bar:recent") ?? "[]"),
    ).toEqual(["build-chart"]);
  });

  it("shows recent commands and renders the empty state for unmatched queries", async () => {
    window.localStorage.setItem(
      "datalens:command-bar:recent",
      JSON.stringify(["open-orders"]),
    );

    render(<CommandBar commands={commands} onExecute={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Command bar/i }));

    await waitFor(() => {
      expect(screen.getByText("Recent")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Open orders dataset/i })).toBeInTheDocument();
    });

    fireEvent.change(
      screen.getByPlaceholderText("Search commands, actions, datasets, charts..."),
      { target: { value: "zzz" } },
    );

    await waitFor(() => {
      expect(screen.getByText("No commands match “zzz”")).toBeInTheDocument();
    });
  });
});
