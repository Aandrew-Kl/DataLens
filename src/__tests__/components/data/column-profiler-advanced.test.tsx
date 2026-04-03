import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnProfilerAdvanced from "@/components/data/column-profiler-advanced";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const numericColumn: ColumnProfile = {
  name: "revenue",
  type: "number",
  nullCount: 5,
  uniqueCount: 80,
  sampleValues: [100, 200, 300],
};

const stringColumn: ColumnProfile = {
  name: "email",
  type: "string",
  nullCount: 3,
  uniqueCount: 70,
  sampleValues: ["alice@example.com", "ops@example.com"],
};

describe("ColumnProfilerAdvanced", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders numeric profiling details, copies statistics, and exports the column", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('COUNT("revenue") AS value_count')) {
        return [
          {
            value_count: 95,
            null_count: 5,
            unique_count: 80,
            min_value: 10,
            max_value: 500,
            mean_value: 120,
            median_value: 110,
            stddev_value: 25,
            variance_value: 625,
            skewness_value: 0.8,
            kurtosis_value: 1.2,
          },
        ];
      }
      if (sql.includes("ORDER BY bucket")) {
        return [
          { start_value: 10, end_value: 50, bucket_count: 20 },
          { start_value: 50, end_value: 90, bucket_count: 10 },
        ];
      }
      if (sql.includes("LIMIT 50")) {
        return [
          { value_label: "100", value_count: 12, percentage: 12.5 },
          { value_label: "200", value_count: 10, percentage: 10.4 },
        ];
      }
      if (sql.includes("whisker_low")) {
        return [
          {
            q1: 80,
            median_value: 110,
            q3: 150,
            lower_bound: -25,
            upper_bound: 255,
            whisker_low: 20,
            whisker_high: 240,
            outlier_count: 4,
          },
        ];
      }
      if (sql.includes("LIMIT 12")) {
        return [
          { value_label: "480", value_count: 2, percentage: 50 },
          { value_label: "500", value_count: 2, percentage: 50 },
        ];
      }
      if (sql.includes('SELECT "revenue" AS value FROM "sales"')) {
        return [{ value: 100 }, { value: 200 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    render(
      <ColumnProfilerAdvanced
        tableName="sales"
        column={numericColumn}
        rowCount={100}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText("Outlier Detection")).toBeInTheDocument();
    expect(screen.getByText("Most Frequent Outlier Values")).toBeInTheDocument();
    expect(screen.getByText("Data Quality")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /copy statistics/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"column": "revenue"'),
    );

    await user.click(screen.getByRole("button", { name: /export column/i }));
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT "revenue" AS value FROM "sales"'),
    );
    expect(clickSpy).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it("renders string pattern analysis and closes on Escape", async () => {
    const onClose = jest.fn();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('COUNT("email") AS value_count')) {
        return [
          {
            value_count: 97,
            null_count: 3,
            unique_count: 70,
            min_value: "alice@example.com",
            max_value: "zoe@example.com",
          },
        ];
      }
      if (sql.includes("LIMIT 20")) {
        return [
          { value_label: "alice@example.com", bucket_count: 6 },
          { value_label: "ops@example.com", bucket_count: 4 },
        ];
      }
      if (sql.includes("LIMIT 50")) {
        return [
          { value_label: "alice@example.com", value_count: 6, percentage: 10 },
          { value_label: "ops@example.com", value_count: 4, percentage: 6.7 },
        ];
      }
      if (sql.includes("email_count")) {
        return [
          {
            non_null_count: 97,
            email_count: 90,
            phone_count: 1,
            url_count: 0,
            blank_count: 2,
            trimmed_count: 94,
          },
        ];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    render(
      <ColumnProfilerAdvanced
        tableName="sales"
        column={stringColumn}
        rowCount={100}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText("Pattern Analysis")).toBeInTheDocument();
    expect(screen.getByText("Email coverage")).toBeInTheDocument();
    expect(screen.queryByText("Outlier Detection")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the profile error state when DuckDB profiling fails", async () => {
    mockRunQuery.mockRejectedValue(new Error("Advanced profile failed"));

    render(
      <ColumnProfilerAdvanced
        tableName="sales"
        column={numericColumn}
        rowCount={100}
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText("Profile Error")).toBeInTheDocument();
    expect(screen.getByText("Advanced profile failed")).toBeInTheDocument();
  });
});
