import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataStoryteller from "@/components/analytics/data-storyteller";
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
jest.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const fullColumns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 5,
    uniqueCount: 50,
    sampleValues: [10, 20],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: [2, 4],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["2025-01-01", "2025-03-01"],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB"],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<DataStoryteller tableName="orders" columns={targetColumns} />);
  });
}

describe("DataStoryteller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a neutral structural story when no strong patterns are found", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 20 }];
      }
      return [];
    });

    await renderAsync([
      {
        name: "notes",
        type: "string",
        nullCount: 0,
        uniqueCount: 50,
        sampleValues: ["a", "b"],
      },
    ]);

    expect(
      await screen.findByText("The dataset looks structurally stable"),
    ).toBeInTheDocument();
  });

  it("exports the story as HTML", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 100 }];
      }
      if (sql.includes('SELECT TRY_CAST("revenue" AS DOUBLE) AS value')) {
        return [10, 12, 14, 18, 22, 25, 28, 35, 50, 80, 120, 160].map(
          (value) => ({ value }),
        );
      }
      return [];
    });

    await renderAsync([fullColumns[0]]);

    await screen.findByText(/revenue carries notable outliers/i);
    await user.selectOptions(screen.getByLabelText(/Export format/i), "html");
    await user.click(screen.getByRole("button", { name: /Export story/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("<!DOCTYPE html>"),
      "orders-story.html",
      "text/html;charset=utf-8;",
    );
  });

  it("surfaces story generation failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Story failed"));

    await renderAsync(fullColumns);

    expect(await screen.findByText("Story failed")).toBeInTheDocument();
  });
});
