import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataStory from "@/components/data/data-story";
import { runQuery } from "@/lib/duckdb/client";
import { assessDataQuality } from "@/lib/utils/data-quality";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));
jest.mock("@/lib/utils/data-quality", () => ({
  assessDataQuality: jest.fn(),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockAssessDataQuality = assessDataQuality as jest.MockedFunction<
  typeof assessDataQuality
>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 5,
    uniqueCount: 80,
    sampleValues: [100, 150, 200],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Enterprise", "SMB"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["2025-01-01", "2025-02-01"],
  },
];

describe("DataStory", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockAssessDataQuality.mockReset();
    mockDownloadFile.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("builds a narrative, copies it, and exports it as HTML", async () => {
    const user = userEvent.setup();
    const writeTextSpy = jest
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    mockAssessDataQuality.mockReturnValue({
      overallScore: 82,
      issues: [{ column: "revenue", severity: "medium", message: "High null rate: 5.0% of values are missing." }],
      summary: "Good data quality (score: 82/100). Found 1 issue(s): 1 medium.",
    });

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("AVG(")) {
        return [
          {
            mean_value: 125,
            median_value: 120,
            stddev_value: 25,
            min_value: 80,
            max_value: 240,
            q1: 100,
            q3: 140,
            outlier_count: 3,
          },
        ];
      }

      if (sql.includes("GROUP BY 1 ORDER BY value_count DESC")) {
        return [{ value: "Enterprise", value_count: 60 }];
      }

      if (sql.includes("distinct_count")) {
        return [{ non_null_count: 100, distinct_count: 4 }];
      }

      if (sql.includes("DATE_DIFF('day'")) {
        return [
          {
            min_value: "2025-01-01T00:00:00.000Z",
            max_value: "2025-03-31T00:00:00.000Z",
            span_days: 89,
          },
        ];
      }

      return [];
    });

    render(<DataStory tableName="sales" columns={columns} rowCount={100} />);

    expect(await screen.findByText("Executive Summary")).toBeInTheDocument();
    expect(screen.getByText("Quality Score")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Copy Story/i }));
    expect(writeTextSpy).toHaveBeenCalledWith(
      expect.stringContaining("Executive Summary"),
    );

    await user.click(screen.getByRole("button", { name: /Export as HTML/i }));
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("<title>sales data story</title>"),
      "sales-data-story.html",
      "text/html;charset=utf-8;",
    );

    writeTextSpy.mockRestore();
  });

  it("renders the error panel when the analysis fails", async () => {
    mockAssessDataQuality.mockReturnValue({
      overallScore: 82,
      issues: [],
      summary: "Good data quality.",
    });
    mockRunQuery.mockRejectedValue(new Error("Narrative query failed"));

    render(<DataStory tableName="sales" columns={columns} rowCount={100} />);

    expect(
      await screen.findByText("Narrative generation failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Narrative query failed")).toBeInTheDocument();
  });
});
