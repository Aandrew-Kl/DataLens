jest.mock("@/lib/utils/data-quality", () => {
  const actual =
    jest.requireActual("@/lib/utils/data-quality") as typeof import("@/lib/utils/data-quality");

  return {
    ...actual,
    assessDataQuality: jest.fn(actual.assessDataQuality),
  };
});

import { assessDataQuality } from "@/lib/utils/data-quality";
import { generateProfileReport } from "@/lib/utils/pdf-report";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

const actualDataQuality =
  jest.requireActual("@/lib/utils/data-quality") as typeof import("@/lib/utils/data-quality");
const mockAssessDataQuality = jest.mocked(assessDataQuality);
const longDateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function makeColumn(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name: "column",
    type: "string",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["alpha", "beta"],
    ...overrides,
  };
}

function makeDataset(overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  const columns = overrides.columns ?? [makeColumn({ name: "dataset_column" })];

  return {
    id: "dataset-id",
    name: "Dataset Name",
    fileName: "dataset.csv",
    rowCount: 10,
    columnCount: columns.length,
    columns,
    uploadedAt: new Date("2024-03-01T09:30:00Z").valueOf(),
    sizeBytes: 1_536,
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2025-01-15T12:00:00Z").valueOf());
  mockAssessDataQuality.mockImplementation(actualDataQuality.assessDataQuality);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("generateProfileReport", () => {
  it("uses explicitly provided columns and row counts for the quality assessment", () => {
    const dataset = makeDataset({
      rowCount: 10,
      columns: [makeColumn({ name: "dataset_only" })],
    });
    const columns = [makeColumn({ name: "override_column" })];

    generateProfileReport(dataset, columns, 99);

    expect(mockAssessDataQuality).toHaveBeenCalledWith(columns, 99);
  });

  it("falls back to dataset columns and row count when the explicit inputs are empty", () => {
    const dataset = makeDataset({
      rowCount: 25,
      sizeBytes: 0,
      columns: [makeColumn({ name: "fallback_column" })],
    });

    mockAssessDataQuality.mockReturnValue({
      overallScore: 59,
      issues: [],
      summary: "No data issues detected.",
    });

    const html = generateProfileReport(dataset, [], 0);

    expect(mockAssessDataQuality).toHaveBeenCalledWith(dataset.columns, 25);
    expect(html).toContain("No active data quality issues");
    expect(html).toContain("No data issues detected.");
    expect(html).toContain("Needs Attention");
    expect(html).toContain("0 B");
  });

  it.each([
    [95, "Excellent"],
    [80, "Strong"],
    [60, "Moderate"],
    [59, "Needs Attention"],
  ])("renders the %s quality band label as %s", (score, expectedLabel) => {
    mockAssessDataQuality.mockReturnValue({
      overallScore: score,
      issues: [],
      summary: "Summary",
    });

    const html = generateProfileReport(makeDataset(), [], 0);

    expect(html).toContain(expectedLabel);
  });

  it("sorts rendered issues by severity and escapes issue content", () => {
    mockAssessDataQuality.mockReturnValue({
      overallScore: 72,
      summary: "Mixed issues",
      issues: [
        { column: "low<column>", severity: "low", message: "low <issue>" },
        { column: "high<column>", severity: "high", message: "high <issue>" },
        { column: "medium<column>", severity: "medium", message: "medium <issue>" },
      ],
    });

    const html = generateProfileReport(makeDataset(), [], 0);

    expect(html.indexOf("high &lt;issue&gt;")).toBeLessThan(
      html.indexOf("medium &lt;issue&gt;"),
    );
    expect(html.indexOf("medium &lt;issue&gt;")).toBeLessThan(
      html.indexOf("low &lt;issue&gt;"),
    );
    expect(html).toContain("high&lt;column&gt;");
    expect(html).toContain("medium&lt;column&gt;");
    expect(html).toContain("low&lt;column&gt;");
  });

  it("renders mixed column types with formatted values and escaped content", () => {
    const dataset = makeDataset({
      id: "report<id>",
      name: "Revenue <script>alert(1)</script>",
      fileName: "q1<&>.csv",
      uploadedAt: new Date("2024-02-03T04:05:00Z").valueOf(),
      sizeBytes: 1_536,
      rowCount: 20,
      columns: [
        makeColumn({
          name: "amount <gross>",
          type: "number",
          nullCount: 2,
          uniqueCount: 18,
          sampleValues: [1000, 2.5, null],
          min: 1,
          max: 2_000,
          mean: 12.345,
          median: 10.2,
        }),
        makeColumn({
          name: "created_at",
          type: "date",
          sampleValues: [],
          min: "not-a-date",
          max: "2024-01-02T03:04:05Z",
        }),
        makeColumn({
          name: "is_active",
          type: "boolean",
          uniqueCount: 2,
          sampleValues: [true, false, null],
        }),
        makeColumn({
          name: "customer_name",
          type: "string",
          uniqueCount: 6,
          sampleValues: [
            "<b>Alice</b>",
            "Bob",
            "Charlie",
            "Dana",
            "Eve",
            "Frank",
            "Grace",
          ],
        }),
        makeColumn({
          name: "mystery",
          type: "unknown",
          sampleValues: [],
        }),
      ],
    });

    const html = generateProfileReport(dataset, dataset.columns, dataset.rowCount);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("q1&lt;&amp;&gt;.csv");
    expect(html).toContain("report&lt;id&gt;");
    expect(html).toContain("amount &lt;gross&gt;");
    expect(html).toContain("&lt;b&gt;Alice&lt;/b&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>Alice</b>");

    expect(html).toContain("Minimum");
    expect(html).toContain("Maximum");
    expect(html).toContain("Mean");
    expect(html).toContain("Median");
    expect(html).toContain("Earliest");
    expect(html).toContain("Latest");
    expect(html).toContain("Observed Values");
    expect(html).toContain("Representative Samples");
    expect(html).toContain("Column type could not be determined confidently");
    expect(html).toContain("No sample values captured");

    expect(html).toContain("12.35");
    expect(html).toContain("2,000");
    expect(html).toContain("True");
    expect(html).toContain("False");
    expect(html).toContain("None");
    expect(html).toContain("not-a-date");
    expect(html).toContain("1.5 KB");
    expect(html).toContain(
      longDateFormatter.format(new Date("2025-01-15T12:00:00Z")),
    );
    expect(html).toContain(
      dateTimeFormatter.format(new Date("2024-02-03T04:05:00Z")),
    );
    expect(html).not.toContain('<span class="sample-chip">Grace</span>');
  });
});
