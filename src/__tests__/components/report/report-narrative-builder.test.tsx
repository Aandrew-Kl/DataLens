import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReportNarrativeBuilder from "@/components/report/report-narrative-builder";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

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
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [12000],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [3000],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["EMEA"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ReportNarrativeBuilder tableName="sales" columns={columns} />);
  });
}

describe("ReportNarrativeBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the narrative builder with initial template sections", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Build templated report narratives with live data references",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Executive summary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Key driver").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recommended action").length).toBeGreaterThan(0);
  });

  it("reorders sections and renders preview text with data references", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ revenue: "$12k", profit: "$3k", region: "EMEA" }]);

    await renderAsync();
    await user.click(screen.getByLabelText("Move Executive summary down"));
    await user.click(screen.getByRole("button", { name: "{{region}}" }));
    await user.click(screen.getByRole("button", { name: "Preview narrative" }));

    expect((await screen.findAllByText(/EMEA/)).length).toBeGreaterThan(0);

    const headings = screen
      .getAllByRole("heading", { level: 4 })
      .map((element) => element.textContent);
    expect(headings[0]).toBe("Key driver");
    expect(headings[1]).toBe("Executive summary");
  });

  it("exports both Markdown and HTML narratives after previewing", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ revenue: "$12k", profit: "$3k", region: "EMEA" }]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Preview narrative" }));
    await screen.findByText("Rendered 3 narrative sections.");

    await user.click(screen.getByRole("button", { name: "Export Markdown" }));
    await user.click(screen.getByRole("button", { name: "Export HTML" }));

    expect(mockDownloadFile).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("## Executive summary"),
      "sales-report-narrative.md",
      "text/markdown;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("<!doctype html>"),
      "sales-report-narrative.html",
      "text/html;charset=utf-8;",
    );
  });
});
