import { assessDataQuality } from "@/lib/utils/data-quality";
import type { ColumnProfile } from "@/types/dataset";

function makeColumn(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name: "value",
    type: "string",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["sample-a", "sample-b"],
    ...overrides,
  };
}

describe("assessDataQuality", () => {
  it("returns a no-data result when no columns are provided", () => {
    expect(assessDataQuality([], 100)).toEqual({
      overallScore: 0,
      issues: [],
      summary: "No data available to assess.",
    });
  });

  it("returns a no-data result when row count is zero", () => {
    expect(assessDataQuality([makeColumn()], 0)).toEqual({
      overallScore: 0,
      issues: [],
      summary: "No data available to assess.",
    });
  });

  it("returns a perfect score for clean datasets", () => {
    const result = assessDataQuality(
      [
        makeColumn({ name: "id", type: "number", uniqueCount: 100 }),
        makeColumn({ name: "name", uniqueCount: 80 }),
      ],
      100,
    );

    expect(result).toEqual({
      overallScore: 100,
      issues: [],
      summary: "Excellent data quality. No issues detected.",
    });
  });

  it("flags null rates above the threshold as medium severity", () => {
    const result = assessDataQuality(
      [makeColumn({ name: "sparse_name", nullCount: 21, uniqueCount: 79 })],
      100,
    );

    expect(result.overallScore).toBe(93);
    expect(result.issues).toEqual([
      {
        column: "sparse_name",
        severity: "medium",
        message: "High null rate: 21.0% of values are missing.",
      },
    ]);
    expect(result.summary).toBe(
      "Good data quality (score: 93/100). Found 1 issue(s): 1 medium.",
    );
  });

  it("does not flag a null rate exactly at the 20 percent threshold", () => {
    const result = assessDataQuality(
      [makeColumn({ name: "borderline", nullCount: 20, uniqueCount: 80 })],
      100,
    );

    expect(result.issues).toEqual([]);
    expect(result.overallScore).toBe(100);
  });

  it("flags null rates of fifty percent or more as high severity", () => {
    const result = assessDataQuality(
      [makeColumn({ name: "mostly_empty", nullCount: 50, uniqueCount: 50 })],
      100,
    );

    expect(result.issues).toEqual([
      {
        column: "mostly_empty",
        severity: "high",
        message: "High null rate: 50.0% of values are missing.",
      },
    ]);
    expect(result.overallScore).toBe(88);
  });

  it("treats fully empty columns as a single high-severity issue and skips further checks", () => {
    const result = assessDataQuality(
      [
        makeColumn({
          name: "user_id",
          type: "unknown",
          nullCount: 100,
          uniqueCount: 0,
        }),
      ],
      100,
    );

    expect(result.issues).toEqual([
      {
        column: "user_id",
        severity: "high",
        message: "Column is entirely empty (100 null values).",
      },
    ]);
    expect(result.overallScore).toBe(88);
  });

  it.each(["id", "user_id", "id_value", "orderid"])(
    "flags duplicate values in ID-like column %s",
    (name) => {
      const result = assessDataQuality(
        [makeColumn({ name, type: "number", nullCount: 1, uniqueCount: 7 })],
        10,
      );

      expect(result.issues).toContainEqual({
        column: name,
        severity: "high",
        message: "Expected unique values but found 2 duplicate(s).",
      });
    },
  );

  it("flags unknown column types", () => {
    const result = assessDataQuality(
      [makeColumn({ name: "mystery", type: "unknown" })],
      100,
    );

    expect(result.issues).toEqual([
      {
        column: "mystery",
        severity: "medium",
        message: "Column data type could not be determined.",
      },
    ]);
    expect(result.overallScore).toBe(93);
  });

  it("summarizes mixed issue severities with the correct qualifier", () => {
    const result = assessDataQuality(
      [
        makeColumn({
          name: "customer_id",
          type: "unknown",
          nullCount: 60,
          uniqueCount: 30,
        }),
      ],
      100,
    );

    expect(result.overallScore).toBe(69);
    expect(result.issues).toHaveLength(3);
    expect(result.summary).toBe(
      "Fair data quality (score: 69/100). Found 3 issue(s): 2 high, 1 medium.",
    );
  });

  it("clamps the score at zero when penalties exceed one hundred", () => {
    const columns = Array.from({ length: 10 }, (_, index) =>
      makeColumn({
        name: `empty_${index}`,
        nullCount: 1,
        uniqueCount: 0,
      }),
    );

    const result = assessDataQuality(columns, 1);

    expect(result.overallScore).toBe(0);
    expect(result.issues).toHaveLength(10);
    expect(result.summary).toBe(
      "Poor data quality (score: 0/100). Found 10 issue(s): 10 high.",
    );
  });
});
