import { act } from "react";
import { render, screen } from "@testing-library/react";

import SentimentAnalyzer from "@/components/analytics/sentiment-analyzer";
import { runQuery } from "@/lib/duckdb/client";
import { sentiment } from "@/lib/api/ai";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/api/ai", () => ({
  sentiment: jest.fn().mockResolvedValue({
    label: "Positive",
    score: 0.9,
    confidence: 0.95,
  }),
}));

jest.mock("@/lib/hooks/use-dark-mode", () => ({
  useDarkMode: jest.fn().mockReturnValue(false),
}));

jest.mock("echarts-for-react/lib/core", () => ({ __esModule: true, default: () => null }));

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ PieChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockSentiment = jest.mocked(sentiment);

const columns: ColumnProfile[] = [
  {
    name: "text",
    type: "string",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["hello", "world"],
  },
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<SentimentAnalyzer tableName="feedback" columns={targetColumns} />);
  });
}

describe("SentimentAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the sentiment workspace with the provided columns", async () => {
    await renderAsync();

    const headings = screen.queryAllByRole("heading");
    const buttons = screen.queryAllByRole("button");
    expect(headings.length + buttons.length).toBeGreaterThan(0);

    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(mockSentiment).not.toHaveBeenCalled();
  });
});
