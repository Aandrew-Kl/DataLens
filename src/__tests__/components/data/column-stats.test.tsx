import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnStats from "@/components/data/column-stats";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("echarts-for-react", () => {
  const R = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: R.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      const { style } = props;
      return R.createElement("div", { ref, "data-testid": "echart", style });
    }),
  };
});

jest.mock("echarts-for-react/lib/core", () => {
  const R = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: R.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      const { style } = props;
      return R.createElement("div", { ref, "data-testid": "echart", style });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: Record<string, ColumnProfile> = {
  revenue: {
    name: "revenue",
    type: "number",
    nullCount: 10,
    uniqueCount: 12,
    sampleValues: [10, 42, 89],
  },
  category: {
    name: "category",
    type: "string",
    nullCount: 2,
    uniqueCount: 6,
    sampleValues: ["Hardware", "Software"],
  },
  created_at: {
    name: "created_at",
    type: "date",
    nullCount: 3,
    uniqueCount: 14,
    sampleValues: ["2024-01-01", "2024-01-08"],
  },
  flagged: {
    name: "flagged",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
};

describe("ColumnStats", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders numeric statistics with summary cards and charts", async () => {
    const user = userEvent.setup();
    void user;

    mockRunQuery
      .mockResolvedValueOnce([
        {
          count: 90,
          distinct_count: 12,
          nulls: 10,
          mean: 52.5,
          median: 48,
          stddev: 7.25,
          min_value: 12,
          max_value: 94,
          range_value: 82,
          q1: 40,
          q3: 60,
        },
      ])
      .mockResolvedValueOnce([{ value: "42" }])
      .mockResolvedValueOnce([
        { start_value: 10, end_value: 20, count: 4 },
        { start_value: 20, end_value: 30, count: 8 },
        { start_value: 30, end_value: 40, count: 12 },
      ]);

    render(
      <ColumnStats tableName="orders" column={columns.revenue} rowCount={100} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Column Statistics")).toBeInTheDocument();
      expect(screen.getByText("Core Metrics")).toBeInTheDocument();
      expect(screen.getByText("Histogram")).toBeInTheDocument();
      expect(screen.getByText("Quartiles & Spread")).toBeInTheDocument();
      expect(screen.getAllByTestId("echart")).toHaveLength(2);
      expect(screen.getByText("90")).toBeInTheDocument();
      expect(screen.getByText("Distinct")).toBeInTheDocument();
    });

    expect(mockRunQuery).toHaveBeenCalledTimes(3);
  });

  it("renders string-specific pattern analysis and top values", async () => {
    mockRunQuery
      .mockResolvedValueOnce([
        {
          count: 98,
          distinct_count: 6,
          nulls: 2,
          min_length: 4,
          max_length: 12,
          avg_length: 7.2,
        },
      ])
      .mockResolvedValueOnce([
        { value: "Hardware", count: 40 },
        { value: "Software", count: 32 },
      ])
      .mockResolvedValueOnce([
        {
          empty_like: 0,
          numeric_like: 0,
          alpha_like: 72,
          alphanumeric: 8,
          email_like: 1,
          url_like: 0,
          surrounding_whitespace: 2,
          mixed_token: 8,
        },
      ]);

    render(
      <ColumnStats tableName="orders" column={columns.category} rowCount={100} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Top 10 Values")).toBeInTheDocument();
      expect(screen.getByText("Pattern Analysis")).toBeInTheDocument();
      expect(screen.getByText("Hardware")).toBeInTheDocument();
      expect(screen.getByText("Email-like")).toBeInTheDocument();
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });
  });

  it("renders date coverage, activity charts, and gap detection", async () => {
    mockRunQuery
      .mockResolvedValueOnce([
        {
          count: 97,
          distinct_count: 14,
          nulls: 3,
          min_date: "2024-01-01",
          max_date: "2024-03-31",
          range_days: 90,
        },
      ])
      .mockResolvedValueOnce([
        { label: "2024-01", count: 30 },
        { label: "2024-02", count: 28 },
      ])
      .mockResolvedValueOnce([
        { label: "Monday", count: 10 },
        { label: "Tuesday", count: 11 },
      ])
      .mockResolvedValueOnce([
        {
          start_date: "2024-01-01",
          end_date: "2024-01-13",
          gap_days: 12,
        },
      ]);

    render(
      <ColumnStats tableName="orders" column={columns.created_at} rowCount={100} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Temporal Coverage")).toBeInTheDocument();
      expect(screen.getByText("Monthly Activity")).toBeInTheDocument();
      expect(screen.getByText("Gap Detection")).toBeInTheDocument();
      expect(screen.getByText("12 days")).toBeInTheDocument();
      expect(screen.getAllByTestId("echart")).toHaveLength(2);
    });
  });

  it("surfaces unsupported column types", async () => {
    render(
      <ColumnStats tableName="orders" column={columns.flagged} rowCount={100} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Column statistics unavailable")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Detailed statistics are only supported for numeric, string, and date columns.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows query failures from the data layer", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Statistics query failed"));

    render(
      <ColumnStats tableName="orders" column={columns.revenue} rowCount={100} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Column statistics unavailable")).toBeInTheDocument();
      expect(screen.getByText("Statistics query failed")).toBeInTheDocument();
    });
  });
});
