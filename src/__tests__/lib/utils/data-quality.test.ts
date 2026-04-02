import { assessDataQuality } from "@/lib/utils/data-quality";
import type { ColumnProfile } from "@/types/dataset";

function makeColumn(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name: "test_col",
    type: "string",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["a", "b", "c"],
    ...overrides,
  };
}

describe("assessDataQuality", () => {
  it("returns high score for clean data", () => {
    const columns: ColumnProfile[] = [
      makeColumn({ name: "id", type: "number", nullCount: 0, uniqueCount: 100 }),
      makeColumn({ name: "name", type: "string", nullCount: 0, uniqueCount: 90 }),
    ];

    const result = assessDataQuality(columns, 100);
    expect(result.overallScore).toBeGreaterThanOrEqual(90);
    expect(result.issues.length).toBe(0);
  });

  it("detects high null rates", () => {
    const columns: ColumnProfile[] = [
      makeColumn({ name: "sparse_col", nullCount: 50, uniqueCount: 20 }),
    ];

    const result = assessDataQuality(columns, 100);
    expect(result.overallScore).toBeLessThan(90);
    expect(result.issues.some((i) => i.column === "sparse_col")).toBe(true);
  });

  it("detects completely empty columns", () => {
    const columns: ColumnProfile[] = [
      makeColumn({ name: "empty_col", nullCount: 100, uniqueCount: 0 }),
    ];

    const result = assessDataQuality(columns, 100);
    expect(result.issues.some((i) => i.severity === "high")).toBe(true);
  });

  it("handles zero rows", () => {
    const columns: ColumnProfile[] = [makeColumn()];
    const result = assessDataQuality(columns, 0);
    expect(result.overallScore).toBeDefined();
  });

  it("handles empty columns array", () => {
    const result = assessDataQuality([], 100);
    expect(result.overallScore).toBeDefined();
    expect(result.issues.length).toBe(0);
  });

  it("provides a summary string", () => {
    const columns: ColumnProfile[] = [
      makeColumn({ name: "col1", nullCount: 5 }),
      makeColumn({ name: "col2", nullCount: 30 }),
    ];

    const result = assessDataQuality(columns, 100);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
