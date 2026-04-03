import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DashboardBuilder from "@/components/charts/dashboard-builder";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [20, 40],
  },
];

describe("DashboardBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("adds a text widget and saves the dashboard to localStorage", async () => {
    const user = userEvent.setup();

    render(
      <DashboardBuilder tableName="sales" columns={columns} rowCount={120} />,
    );

    await user.click(screen.getByRole("button", { name: /add widget/i }));
    await user.click(screen.getByRole("button", { name: /text widget/i }));

    const titleInput = screen.getByDisplayValue("Notes");
    await user.clear(titleInput);
    await user.type(titleInput, "Quarterly narrative");

    const textArea = screen.getByDisplayValue(
      "Use this space for notes, caveats, and next steps.",
    );
    await user.clear(textArea);
    await user.type(textArea, "Revenue is strongest in the East region.");

    expect(
      await screen.findByText("Quarterly narrative"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Revenue is strongest in the East region."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save dashboard/i }));

    expect(
      await screen.findByText("Saved 1 widgets for sales."),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("datalens-dashboard:sales")).toContain(
      "Quarterly narrative",
    );
  });

  it("loads a saved dashboard and exports it as standalone HTML", async () => {
    const user = userEvent.setup();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    window.localStorage.setItem(
      "datalens-dashboard:sales",
      JSON.stringify({
        savedAt: Date.now(),
        widgets: [
          {
            id: "widget-text",
            type: "text",
            title: "Loaded note",
            xAxis: "",
            yAxis: "",
            aggregation: "sum",
            color: "#38bdf8",
            tableColumns: [],
            text: "Loaded from storage.",
          },
        ],
      }),
    );

    render(
      <DashboardBuilder tableName="sales" columns={columns} rowCount={120} />,
    );

    await user.click(screen.getByRole("button", { name: /load dashboard/i }));

    expect(await screen.findByText("Loaded note")).toBeInTheDocument();
    expect(screen.getByText("Loaded from storage.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /export dashboard/i }));

    expect(
      await screen.findByText(/Exported the dashboard as standalone HTML\./i),
    ).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("shows widget preview failures from DuckDB", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Widget preview failed"));

    render(
      <DashboardBuilder tableName="sales" columns={columns} rowCount={120} />,
    );

    await user.click(screen.getByRole("button", { name: /add widget/i }));
    await user.click(screen.getByRole("button", { name: /bar chart/i }));

    expect(
      await screen.findByText("Widget preview failed"),
    ).toBeInTheDocument();
  });
});
