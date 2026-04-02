import {
  mean,
  median,
  mode,
  standardDeviation,
  variance,
  quartiles,
  iqr,
  zScore,
  percentile,
  correlation,
  entropy,
  skewness,
  kurtosis,
} from "@/lib/utils/statistics";

describe("mean", () => {
  it("returns NaN for empty arrays", () => {
    expect(mean([])).toBeNaN();
  });

  it("calculates averages for single and negative values", () => {
    expect(mean([42])).toBe(42);
    expect(mean([-4, -2, 0])).toBe(-2);
  });
});

describe("median", () => {
  it("returns NaN for empty arrays", () => {
    expect(median([])).toBeNaN();
  });

  it("handles single values and interpolates even-length arrays", () => {
    expect(median([7])).toBe(7);
    expect(median([1, 4, 2, 3])).toBe(2.5);
  });
});

describe("mode", () => {
  it("returns an empty array for empty input", () => {
    expect(mode([])).toEqual([]);
  });

  it("returns all modal values sorted ascending", () => {
    expect(mode([-3, -1, -3, -2, -2, 4])).toEqual([-3, -2]);
  });
});

describe("variance", () => {
  it("returns 0 for a single value", () => {
    expect(variance([9])).toBe(0);
  });

  it("calculates population variance for negative and positive values", () => {
    expect(variance([-2, 0, 2])).toBeCloseTo(8 / 3, 10);
    expect(variance([1, 2, 3, 4])).toBe(1.25);
  });
});

describe("standardDeviation", () => {
  it("calculates population standard deviation", () => {
    expect(standardDeviation([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(1.25), 10);
  });
});

describe("quartiles", () => {
  it("returns NaN quartiles for empty arrays", () => {
    const result = quartiles([]);

    expect(result.q1).toBeNaN();
    expect(result.q2).toBeNaN();
    expect(result.q3).toBeNaN();
  });

  it("calculates quartiles with interpolation", () => {
    const result = quartiles([1, 2, 3, 4]);

    expect(result.q1).toBeCloseTo(1.75, 10);
    expect(result.q2).toBeCloseTo(2.5, 10);
    expect(result.q3).toBeCloseTo(3.25, 10);
  });
});

describe("iqr", () => {
  it("returns NaN for empty arrays", () => {
    expect(iqr([])).toBeNaN();
  });

  it("calculates the interquartile range", () => {
    expect(iqr([1, 2, 3, 4])).toBeCloseTo(1.5, 10);
  });
});

describe("zScore", () => {
  it("calculates z-scores for valid inputs", () => {
    expect(zScore(7, 5, 2)).toBe(1);
  });

  it("handles zero standard deviation and invalid spreads", () => {
    expect(zScore(5, 5, 0)).toBe(0);
    expect(zScore(6, 5, 0)).toBeNaN();
    expect(zScore(5, 5, -1)).toBeNaN();
  });
});

describe("percentile", () => {
  it("returns NaN for empty arrays and invalid percentile values", () => {
    expect(percentile([], 50)).toBeNaN();
    expect(percentile([1, 2, 3], -1)).toBeNaN();
    expect(percentile([1, 2, 3], 101)).toBeNaN();
  });

  it("calculates percentiles for single and multi-value arrays", () => {
    expect(percentile([10], 25)).toBe(10);
    expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 10);
  });
});

describe("correlation", () => {
  it("returns NaN for mismatched or constant series", () => {
    expect(correlation([1, 2], [1])).toBeNaN();
    expect(correlation([1, 1, 1], [2, 3, 4])).toBeNaN();
  });

  it("calculates perfect positive and negative correlations", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(correlation([-1, -2, -3], [1, 2, 3])).toBeCloseTo(-1, 10);
  });
});

describe("entropy", () => {
  it("handles empty, uniform, and evenly distributed inputs", () => {
    expect(entropy([])).toBe(0);
    expect(entropy([5, 5, 5])).toBe(0);
    expect(entropy([1, 2, 3, 4])).toBeCloseTo(2, 10);
  });
});

describe("skewness", () => {
  it("returns 0 for single-value and symmetric distributions", () => {
    expect(skewness([10])).toBe(0);
    expect(skewness([-2, -1, 0, 1, 2])).toBeCloseTo(0, 10);
  });
});

describe("kurtosis", () => {
  it("returns 0 for single-value input", () => {
    expect(kurtosis([10])).toBe(0);
  });

  it("calculates excess kurtosis for a flat distribution", () => {
    expect(kurtosis([1, 2, 3, 4])).toBeCloseTo(-1.36, 10);
  });
});
