import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnCorrelator from "@/components/data/column-correlator";
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
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 30,
    sampleValues: [10, 20],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 30,
    sampleValues: [2, 4],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
];

describe("ColumnCorrelator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("runs numeric-to-numeric analysis and renders the correlation result", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("corr(x_value, y_value)")) {
        return [
          {
            pearson: 0.86,
            slope: 0.45,
            intercept: 1.2,
            pair_count: 80,
          },
        ];
      }

      return [
        { x_value: 10, y_value: 3 },
        { x_value: 20, y_value: 5 },
      ];
    });

    render(
      <ColumnCorrelator tableName="sales" columns={columns} rowCount={100} />,
    );

    await user.click(screen.getByRole("button", { name: /analyze columns/i }));

    expect(await screen.findByText("sales vs profit")).toBeInTheDocument();
    expect(screen.getByText("Pearson correlation")).toBeInTheDocument();
    expect(screen.getByText("0.860")).toBeInTheDocument();
    expect(screen.getByText("Strong positive correlation")).toBeInTheDocument();
    expect(
      screen.getByText(/80\.0% of the source table contributed valid pairs/i),
    ).toBeInTheDocument();
  });

  it("switches to numeric-vs-categorical analysis when the selected columns change", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("overall_mean")) {
        return [
          {
            pair_count: 70,
            overall_mean: 18,
            overall_var: 25,
          },
        ];
      }

      return [
        {
          category: "East",
          pair_count: 30,
          mean_value: 22,
          min_value: 10,
          q1_value: 14,
          median_value: 20,
          q3_value: 28,
          max_value: 35,
        },
        {
          category: "West",
          pair_count: 40,
          mean_value: 14,
          min_value: 7,
          q1_value: 10,
          median_value: 12,
          q3_value: 18,
          max_value: 26,
        },
      ];
    });

    render(
      <ColumnCorrelator tableName="sales" columns={columns} rowCount={100} />,
    );

    await user.selectOptions(screen.getByLabelText("Column B"), "region");

    expect(
      screen.getByText(/Box plot per category plus mean comparison/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /analyze columns/i }));

    expect(await screen.findByText("sales by region")).toBeInTheDocument();
    expect(screen.getByText("Eta squared")).toBeInTheDocument();
    expect(screen.getByText("0.640")).toBeInTheDocument();
    expect(
      screen.getByText("Strong category-driven separation"),
    ).toBeInTheDocument();
  });

  it("shows query errors when the analysis fails", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Correlation analysis failed"));

    render(
      <ColumnCorrelator tableName="sales" columns={columns} rowCount={100} />,
    );

    await user.click(screen.getByRole("button", { name: /analyze columns/i }));

    expect(
      await screen.findByText("Correlation analysis failed"),
    ).toBeInTheDocument();
  });
});
