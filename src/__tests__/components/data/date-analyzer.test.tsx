import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DateAnalyzer from "@/components/data/date-analyzer";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({ downloadFile: jest.fn() }));
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {}, LineChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["2025-01-01", "2025-01-03"],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<DateAnalyzer tableName="orders" columns={targetColumns} />);
  });
}

describe("DateAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty guidance when there are no date columns", async () => {
    await renderAsync([
      {
        name: "status",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["open", "closed"],
      },
    ]);

    expect(screen.getByText("Choose a date column to analyze.")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("analyzes date coverage, weekday distribution, and gaps", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2025-01-01", row_count: 3 },
      { bucket_date: "2025-01-03", row_count: 5 },
      { bucket_date: "2025-02-01", row_count: 4 },
    ]);

    await renderAsync(columns);
    await user.click(screen.getByRole("button", { name: "Analyze dates" }));

    expect(await screen.findByText("Gap detection")).toBeInTheDocument();
    expect(screen.getByText("Jan 2, 2025")).toBeInTheDocument();
    expect(screen.getAllByTestId("echart")).toHaveLength(2);
  });

  it("exports the date analysis summary", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2025-01-01", row_count: 3 },
      { bucket_date: "2025-01-03", row_count: 5 },
    ]);

    await renderAsync(columns);
    await user.click(screen.getByRole("button", { name: "Analyze dates" }));
    await screen.findByText("Gap detection");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("missing_dates"),
      "orders-created_at-date-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
