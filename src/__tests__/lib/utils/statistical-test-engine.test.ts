import { runQuery } from "@/lib/duckdb/client";
import {
  runAnova,
  runChiSquare,
  runKolmogorovSmirnov,
  runMannWhitney,
  runTTest,
} from "@/lib/utils/statistical-test-engine";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

describe("statistical-test-engine", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    jest.restoreAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("runs a Welch t-test and returns computed significance details", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { grp: "control", n: 10, mean: 12, variance: 4 },
      { grp: "variant", n: 10, mean: 8, variance: 4 },
    ]);

    const result = await runTTest("orders", {
      measure: "revenue",
      group: "segment",
      groupA: "control",
      groupB: "variant",
      confidence: 0.95,
      alternative: "two-sided",
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('CAST("revenue" AS DOUBLE)'),
    );
    expect(result).toMatchObject({
      type: "t-test",
      title: "revenue: control vs variant",
      statisticLabel: "t statistic",
      effectLabel: "Cohen's d",
      significant: true,
      runAt: 1_700_000_000_000,
    });
    expect(result.statistic).toBeCloseTo(4.4721, 3);

    expect(result.pValue).not.toBeNull();
    if (result.pValue === null) {
      throw new Error("Expected a p-value for the t-test");
    }
    expect(result.pValue).toBeLessThan(0.01);

    expect(result.confidenceInterval).not.toBeNull();
    if (result.confidenceInterval === null) {
      throw new Error("Expected a confidence interval for the t-test");
    }
    expect(result.confidenceInterval[0]).toBeCloseTo(2.247, 3);
    expect(result.confidenceInterval[1]).toBeCloseTo(5.753, 3);
    expect(result.details).toEqual(
      expect.arrayContaining([
        { label: "control mean", value: "12.000" },
        { label: "variant mean", value: "8.000" },
      ]),
    );
  });

  it("rejects invalid t-test configurations before querying DuckDB", async () => {
    await expect(
      runTTest("orders", {
        measure: "revenue",
        group: "segment",
        groupA: "control",
        groupB: "control",
        confidence: 0.95,
        alternative: "two-sided",
      }),
    ).rejects.toThrow(
      "Pick a numeric measure and two distinct groups for the t-test.",
    );

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("supports one-sided t-tests at lower confidence levels", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { grp: "control", n: 5, mean: 5, variance: 1 },
      { grp: "variant", n: 5, mean: 6, variance: 1 },
    ]);

    const result = await runTTest("orders", {
      measure: "revenue",
      group: "segment",
      groupA: "control",
      groupB: "variant",
      confidence: 0.8,
      alternative: "less",
    });

    expect(result.significant).toBe(true);
    expect(result.pValue).not.toBeNull();
    expect(result.confidenceInterval).not.toBeNull();
    expect(result.confidenceInterval?.[0]).toBeCloseTo(-1.81, 1);
    expect(result.confidenceInterval?.[1]).toBeCloseTo(-0.19, 1);
  });

  it("uses the 90% confidence critical value for t-tests", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { grp: "control", n: 5, mean: 6, variance: 1 },
      { grp: "variant", n: 5, mean: 5, variance: 1 },
    ]);

    const result = await runTTest("orders", {
      measure: "revenue",
      group: "segment",
      groupA: "control",
      groupB: "variant",
      confidence: 0.9,
      alternative: "greater",
    });

    expect(result.significant).toBe(true);
    expect(result.confidenceInterval).not.toBeNull();
    expect(result.confidenceInterval?.[0]).toBeCloseTo(-0.04, 1);
    expect(result.confidenceInterval?.[1]).toBeCloseTo(2.04, 1);
  });

  it("runs a chi-square test and reports association strength", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { left_value: "A", right_value: "X", cell_count: 30 },
      { left_value: "A", right_value: "Y", cell_count: 10 },
      { left_value: "B", right_value: "X", cell_count: 10 },
      { left_value: "B", right_value: "Y", cell_count: 30 },
    ]);

    const result = await runChiSquare("orders", {
      left: "region",
      right: "channel",
      confidence: 0.95,
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('CAST("region" AS VARCHAR)'),
    );
    expect(result).toMatchObject({
      type: "chi-square",
      statisticLabel: "Chi-square",
      effectLabel: "Cramer's V",
      significant: true,
    });
    expect(result.statistic).toBeCloseTo(20, 6);
    expect(result.effectSize).toBeCloseTo(0.5, 6);
    expect(result.details).toEqual(
      expect.arrayContaining([
        { label: "Rows in table", value: "80" },
        { label: "Degrees of freedom", value: "1" },
      ]),
    );
  });

  it("runs ANOVA across multiple groups and returns eta-squared", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { grp: "A", n: 10, mean: 5, variance: 1 },
      { grp: "B", n: 10, mean: 10, variance: 1 },
      { grp: "C", n: 10, mean: 15, variance: 1 },
    ]);

    const result = await runAnova("orders", {
      measure: "revenue",
      group: "segment",
      confidence: 0.95,
      maxGroups: 3,
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 3"),
    );
    expect(result).toMatchObject({
      type: "anova",
      statisticLabel: "F statistic",
      effectLabel: "Eta squared",
      significant: true,
    });
    expect(result.statistic).toBeCloseTo(250, 6);
    expect(result.effectSize).toBeCloseTo(500 / 527, 6);
    expect(result.details).toEqual(
      expect.arrayContaining([
        { label: "Groups tested", value: "3" },
        { label: "Grand mean", value: "10.000" },
      ]),
    );
  });

  it("rejects ANOVA inputs that cannot estimate within-group variance", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { grp: "A", n: 1, mean: 5, variance: 0 },
      { grp: "B", n: 1, mean: 5, variance: 0 },
    ]);

    await expect(
      runAnova("orders", {
        measure: "revenue",
        group: "segment",
        confidence: 0.95,
        maxGroups: 4,
      }),
    ).rejects.toThrow(
      "There is not enough data to estimate within-group variance.",
    );
  });

  it("runs a Mann-Whitney U test and reports a rank-based effect size", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { grp: "control", n: 5, rank_sum: 40, mean_value: 10 },
      { grp: "variant", n: 5, rank_sum: 15, mean_value: 5 },
    ]);

    const result = await runMannWhitney("orders", {
      measure: "revenue",
      group: "segment",
      groupA: "control",
      groupB: "variant",
      confidence: 0.95,
      alternative: "two-sided",
    });

    expect(result).toMatchObject({
      type: "mann-whitney",
      statisticLabel: "U statistic",
      effectLabel: "Rank-biserial proxy",
      significant: true,
    });
    expect(result.statistic).toBe(0);
    expect(result.effectSize).toBeCloseTo(0.826, 3);
    expect(result.details).toEqual(
      expect.arrayContaining([
        { label: "control rows", value: "5" },
        { label: "variant rows", value: "5" },
      ]),
    );
  });

  it("handles non-significant one-sided Mann-Whitney results", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { grp: "control", n: 1, rank_sum: 1, mean_value: 10 },
      { grp: "variant", n: 1, rank_sum: 2, mean_value: 10 },
    ]);

    const result = await runMannWhitney("orders", {
      measure: "revenue",
      group: "segment",
      groupA: "control",
      groupB: "variant",
      confidence: 0.95,
      alternative: "greater",
    });

    expect(result.significant).toBe(false);
    expect(result.interpretation).toContain("similar rank distributions");
    expect(result.pValue).toBeGreaterThan(0.5);
  });

  it("runs a Kolmogorov-Smirnov test and reports the distribution distance", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { d_stat: 0.6, n1: 20, n2: 20 },
    ]);

    const result = await runKolmogorovSmirnov("orders", {
      measure: "revenue",
      group: "segment",
      groupA: "control",
      groupB: "variant",
      confidence: 0.95,
      alternative: "two-sided",
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining("CUME_DIST()"),
    );
    expect(result).toMatchObject({
      type: "kolmogorov-smirnov",
      statisticLabel: "D statistic",
      effectLabel: "Distribution distance",
      significant: true,
    });
    expect(result.statistic).toBeCloseTo(0.6, 6);
    expect(result.effectSize).toBeCloseTo(0.6, 6);
    expect(result.details).toEqual(
      expect.arrayContaining([
        { label: "Effective n", value: "10.0" },
        { label: "Confidence level", value: "95%" },
      ]),
    );
  });

  it("rejects Kolmogorov-Smirnov inputs when one group is missing", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { d_stat: 0.2, n1: 5, n2: 0 },
    ]);

    await expect(
      runKolmogorovSmirnov("orders", {
        measure: "revenue",
        group: "segment",
        groupA: "control",
        groupB: "variant",
        confidence: 0.95,
        alternative: "two-sided",
      }),
    ).rejects.toThrow("Each group needs data to compare distributions.");
  });
});
