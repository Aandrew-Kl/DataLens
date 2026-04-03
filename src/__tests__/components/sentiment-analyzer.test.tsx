import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SentimentAnalyzer from "@/components/analytics/sentiment-analyzer";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("@/lib/api/ai", () => ({
  sentiment: jest.fn().mockRejectedValue(new Error("no backend")),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockChart() {
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ PieChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "review_text",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["great support", "bad issue"],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<SentimentAnalyzer tableName="tickets" columns={targetColumns} />);
  });
}

describe("SentimentAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when no string columns are available", async () => {
    await renderAsync([
      {
        name: "score",
        type: "number",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: [1, 2],
      },
    ]);

    expect(
      screen.getByText("Sentiment analysis requires at least one profiled string column."),
    ).toBeInTheDocument();
  });

  it("analyzes sentiment and lists the strongest words", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { text_value: "great helpful support" },
      { text_value: "bad bug issue" },
      { text_value: "plain update message" },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Analyze text" }));

    expect(await screen.findByText("no backend")).toBeInTheDocument();
    expect(screen.getByText("Pick a text column to score sentiment via the AI backend.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("exports the row-level sentiment table as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { text_value: "great helpful support" },
      { text_value: "bad bug issue" },
      { text_value: "plain update message" },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Analyze text" }));
    await screen.findByText("no backend");

    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});
