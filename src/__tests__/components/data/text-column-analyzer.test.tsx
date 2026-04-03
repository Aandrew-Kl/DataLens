import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TextColumnAnalyzer from "@/components/data/text-column-analyzer";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockChart(props: Record<string, unknown>) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "notes",
    type: "string",
    nullCount: 5,
    uniqueCount: 20,
    sampleValues: ["hello world", "visit https://example.com"],
  },
  {
    name: "emails",
    type: "string",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["ada@example.com", "grace@example.com"],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<TextColumnAnalyzer tableName="sales" columns={targetColumns} />);
  });
}

describe("TextColumnAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when there are no text columns", async () => {
    await renderAsync([
      {
        name: "amount",
        type: "number",
        nullCount: 0,
        uniqueCount: 12,
        sampleValues: [10, 20],
      },
    ]);

    expect(
      await screen.findByText("Choose a text column to analyze."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads text findings, pattern counts, and charts", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("total_rows")) {
        return [
          {
            total_rows: 100,
            non_null_rows: 95,
            empty_rows: 5,
            unique_values: 22,
          },
        ];
      }
      if (sql.includes("ORDER BY value_count DESC")) {
        return [
          { value: "hello world", value_count: 10 },
          { value: "status ok", value_count: 8 },
        ];
      }
      return [
        { value: "hello world" },
        { value: "hello world" },
        { value: "visit https://example.com" },
        { value: "contact ada@example.com" },
        { value: "2025-01-02" },
      ];
    });

    await renderAsync(columns);

    expect(await screen.findByText("Pattern detection")).toBeInTheDocument();
    expect(screen.getByText("free-text")).toBeInTheDocument();
    expect(screen.getAllByTestId("echart")).toHaveLength(2);
  });

  it("changes the selected column and reloads analysis", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('"emails"')) {
        if (sql.includes("total_rows")) {
          return [
            {
              total_rows: 20,
              non_null_rows: 20,
              empty_rows: 0,
              unique_values: 10,
            },
          ];
        }
        if (sql.includes("ORDER BY value_count DESC")) {
          return [{ value: "ada@example.com", value_count: 4 }];
        }
        return [
          { value: "ada@example.com" },
          { value: "grace@example.com" },
        ];
      }

      if (sql.includes("total_rows")) {
        return [
          {
            total_rows: 100,
            non_null_rows: 95,
            empty_rows: 5,
            unique_values: 22,
          },
        ];
      }
      if (sql.includes("ORDER BY value_count DESC")) {
        return [{ value: "hello world", value_count: 10 }];
      }
      return [{ value: "hello world" }];
    });

    await renderAsync(columns);
    await screen.findByText("Pattern detection");

    await user.selectOptions(screen.getByLabelText(/Text column/i), "emails");

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('"emails"'),
      );
    });
  });

  it("exports findings as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("total_rows")) {
        return [
          {
            total_rows: 100,
            non_null_rows: 95,
            empty_rows: 5,
            unique_values: 22,
          },
        ];
      }
      if (sql.includes("ORDER BY value_count DESC")) {
        return [{ value: "hello world", value_count: 10 }];
      }
      return [{ value: "hello world" }];
    });

    await renderAsync(columns);
    await screen.findByText("Pattern detection");

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("suggested_type"),
      "sales-notes-text-findings.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces analysis failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Text scan failed"));

    await renderAsync(columns);

    expect(await screen.findByText("Text scan failed")).toBeInTheDocument();
  });
});
