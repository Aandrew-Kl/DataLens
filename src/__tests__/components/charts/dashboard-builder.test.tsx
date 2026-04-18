import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

    render(
      <DashboardBuilder tableName="sales" columns={columns} rowCount={120} />,
    );

    await user.click(screen.getByRole("button", { name: /add widget/i }));
    await user.click(screen.getByRole("button", { name: /text widget/i }));

    const titleInput = screen.getByDisplayValue("Notes");
    fireEvent.change(titleInput, { target: { value: "Quarterly narrative" } });

    const textArea = screen.getByDisplayValue(
      "Use this space for notes, caveats, and next steps.",
    );
    fireEvent.change(textArea, {
      target: { value: "Revenue is strongest in the East region." },
    });

    expect(titleInput).toHaveValue("Quarterly narrative");
    expect(textArea).toHaveValue("Revenue is strongest in the East region.");

    fireEvent.click(screen.getByRole("button", { name: /save dashboard/i }));

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith(
        "datalens-dashboard:sales",
        expect.stringContaining("Quarterly narrative"),
      );
    });
    expect(window.localStorage.getItem("datalens-dashboard:sales")).toContain(
      "Quarterly narrative",
    );
    expect(window.localStorage.getItem("datalens-dashboard:sales")).toContain(
      "Revenue is strongest in the East region.",
    );

    setItemSpy.mockRestore();
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

    await waitFor(() => {
      expect(screen.getByText("Loaded note")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText("Loaded from storage.").length).toBeGreaterThan(0);
    });

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

  it("builds KPI and scatter preview queries for added widgets", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS value")) {
        return [{ value: 120 }];
      }
      if (sql.includes("AS x_value, \"revenue\" AS y_value")) {
        return [{ x_value: 20, y_value: 100 }];
      }
      if (sql.includes("SELECT \"region\", \"revenue\", \"profit\" FROM \"sales\" LIMIT 8")) {
        return [{ region: "East", revenue: 100, profit: 20 }];
      }
      return [{ label: "East", value: 100 }];
    });

    render(
      <DashboardBuilder tableName="sales" columns={columns} rowCount={120} />,
    );

    await user.click(screen.getByRole("button", { name: /add widget/i }));
    await user.click(screen.getByRole("button", { name: /KPI Card/i }));

    fireEvent.change(screen.getByDisplayValue("SUM"), {
      target: { value: "count" },
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining("COUNT(*) AS value"),
      );
    });

    await user.click(screen.getByRole("button", { name: /add widget/i }));
    await user.click(screen.getByRole("button", { name: /Scatter Plot/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT "region" AS x_value, "revenue" AS y_value'),
      );
    });
  });

  it("builds table preview queries for table widgets", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('SELECT "region", "revenue", "profit" FROM "sales" LIMIT 8')) {
        return [{ region: "East", revenue: 100, profit: 20 }];
      }
      return [{ label: "East", value: 100 }];
    });

    render(
      <DashboardBuilder tableName="sales" columns={columns} rowCount={120} />,
    );

    await user.click(screen.getByRole("button", { name: /add widget/i }));
    await user.click(screen.getByRole("button", { name: /Table Widget/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          'SELECT "region", "revenue", "profit" FROM "sales" LIMIT 8',
        ),
      );
    });
  });

  it("surfaces load failures when saved dashboard state is invalid", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem("datalens-dashboard:sales", "{bad json");

    render(
      <DashboardBuilder tableName="sales" columns={columns} rowCount={120} />,
    );

    await user.click(screen.getByRole("button", { name: /load dashboard/i }));

    expect(
      await screen.findByText(/Expected property name/),
    ).toBeInTheDocument();
  });
});
