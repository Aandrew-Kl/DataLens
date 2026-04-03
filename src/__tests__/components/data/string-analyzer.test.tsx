import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StringAnalyzer from "@/components/data/string-analyzer";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({ downloadFile: jest.fn() }));
jest.mock("echarts-for-react/lib/core");
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
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["hello", "https://example.com"],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<StringAnalyzer tableName="sales" columns={targetColumns} />);
  });
}

describe("StringAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty guidance when there are no string columns", async () => {
    await renderAsync([
      {
        name: "amount",
        type: "number",
        nullCount: 0,
        uniqueCount: 4,
        sampleValues: [1, 2],
      },
    ]);

    expect(screen.getByText("Choose a string column to analyze.")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads pattern counts and top values", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("total_rows")) {
        return [
          {
            total_rows: 20,
            non_null_rows: 18,
            empty_rows: 2,
            unique_rows: 12,
          },
        ];
      }
      if (sql.includes("ORDER BY value_count DESC")) {
        return [{ value: "hello", value_count: 5 }];
      }
      return [
        { value: "hello" },
        { value: "hello" },
        { value: "ada@example.com" },
        { value: "https://example.com" },
        { value: "+30 210 555 5555" },
      ];
    });

    await renderAsync(columns);
    await user.click(screen.getByRole("button", { name: "Analyze strings" }));

    expect(await screen.findByText("Pattern detection")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("exports the aggregated string analysis", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("total_rows")) {
        return [
          {
            total_rows: 20,
            non_null_rows: 18,
            empty_rows: 2,
            unique_rows: 12,
          },
        ];
      }
      if (sql.includes("ORDER BY value_count DESC")) {
        return [{ value: "hello", value_count: 5 }];
      }
      return [{ value: "hello" }];
    });

    await renderAsync(columns);
    await user.click(screen.getByRole("button", { name: "Analyze strings" }));
    await screen.findByText("Pattern detection");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("duplicate_rows"),
      "sales-notes-string-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
