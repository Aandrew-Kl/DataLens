import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TextMiningTool from "@/components/data/text-mining-tool";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "review_text",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["great fast support", "bad slow error"],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<TextMiningTool tableName="reviews" columns={columns} />);
  });
}

describe("TextMiningTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the text mining controls", async () => {
    await renderComponent();

    expect(
      screen.getByText("Mine term frequency, n-grams, and sentiment hints from text columns"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze/i })).toBeInTheDocument();
  });

  it("analyzes word frequency and n-grams from the selected text column", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { text_value: "great fast support" },
      { text_value: "great fast onboarding" },
      { text_value: "bad slow error" },
    ]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Analyze/i }));

    expect(await screen.findByText("great")).toBeInTheDocument();
    expect(screen.getByText("great fast")).toBeInTheDocument();
    expect(screen.getByText("Positive Hits")).toBeInTheDocument();
  });

  it("exports mined term data as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { text_value: "great fast support" },
      { text_value: "great fast onboarding" },
    ]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Analyze/i }));
    await screen.findByText("great");
    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("kind,term,count"),
      "reviews-review_text-mining.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
