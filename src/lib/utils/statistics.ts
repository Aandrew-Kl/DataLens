/**
 * Pure statistics helpers for numeric arrays.
 * Undefined results return `NaN`, except `mode()` which returns `[]`.
 */

type Quartiles = { q1: number; q2: number; q3: number };

function hasFiniteValues(values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

function hasUsableValues(values: number[]): boolean {
  return values.length > 0 && hasFiniteValues(values);
}

function sortedCopy(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function sum(values: number[]): number {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total;
}

function emptyQuartiles(): Quartiles {
  return { q1: Number.NaN, q2: Number.NaN, q3: Number.NaN };
}

function percentileFromSorted(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0 || !Number.isFinite(p) || p < 0 || p > 100) {
    return Number.NaN;
  }

  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const rank = (p / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;

  return (
    sortedValues[lowerIndex] +
    (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight
  );
}

function centralMoment(values: number[], order: number, center: number): number {
  let total = 0;

  for (const value of values) {
    total += Math.pow(value - center, order);
  }

  return total / values.length;
}

/** Arithmetic mean. */
export function mean(values: number[]): number {
  if (!hasUsableValues(values)) return Number.NaN;
  return sum(values) / values.length;
}

/** Median with interpolation for even-length arrays. */
export function median(values: number[]): number {
  if (!hasUsableValues(values)) return Number.NaN;
  return percentileFromSorted(sortedCopy(values), 50);
}

/** All modal values, sorted ascending. */
export function mode(values: number[]): number[] {
  if (!hasUsableValues(values)) return [];

  const counts = new Map<number, number>();
  let maxCount = 0;

  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    maxCount = Math.max(maxCount, count);
  }

  return [...counts.entries()]
    .filter(([, count]) => count === maxCount)
    .map(([value]) => value)
    .sort((a, b) => a - b);
}

/** Population variance. */
export function variance(values: number[]): number {
  if (!hasUsableValues(values)) return Number.NaN;
  if (values.length === 1) return 0;

  const average = mean(values);
  let total = 0;

  for (const value of values) {
    const delta = value - average;
    total += delta * delta;
  }

  return total / values.length;
}

/** Population standard deviation. */
export function standardDeviation(values: number[]): number {
  const spread = variance(values);
  return Number.isNaN(spread) ? Number.NaN : Math.sqrt(spread);
}

/** Quartiles based on the shared percentile implementation. */
export function quartiles(values: number[]): Quartiles {
  if (!hasUsableValues(values)) return emptyQuartiles();

  const sortedValues = sortedCopy(values);

  return {
    q1: percentileFromSorted(sortedValues, 25),
    q2: percentileFromSorted(sortedValues, 50),
    q3: percentileFromSorted(sortedValues, 75),
  };
}

/** Interquartile range. */
export function iqr(values: number[]): number {
  if (!hasUsableValues(values)) return Number.NaN;

  const { q1, q3 } = quartiles(values);
  return q3 - q1;
}

/** Z-score with zero-spread protection. */
export function zScore(value: number, meanValue: number, stddev: number): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(meanValue) ||
    !Number.isFinite(stddev) ||
    stddev < 0
  ) {
    return Number.NaN;
  }

  if (stddev === 0) {
    return value === meanValue ? 0 : Number.NaN;
  }

  return (value - meanValue) / stddev;
}

/** Inclusive percentile in the range 0..100. */
export function percentile(values: number[], p: number): number {
  if (!hasUsableValues(values)) return Number.NaN;
  return percentileFromSorted(sortedCopy(values), p);
}

/** Pearson correlation coefficient. */
export function correlation(x: number[], y: number[]): number {
  if (
    x.length !== y.length ||
    x.length < 2 ||
    !hasFiniteValues(x) ||
    !hasFiniteValues(y)
  ) {
    return Number.NaN;
  }

  const meanX = mean(x);
  const meanY = mean(y);
  let covariance = 0;
  let sumSquaresX = 0;
  let sumSquaresY = 0;

  for (let index = 0; index < x.length; index += 1) {
    const deltaX = x[index] - meanX;
    const deltaY = y[index] - meanY;

    covariance += deltaX * deltaY;
    sumSquaresX += deltaX * deltaX;
    sumSquaresY += deltaY * deltaY;
  }

  const denominator = Math.sqrt(sumSquaresX * sumSquaresY);
  return denominator === 0 ? Number.NaN : covariance / denominator;
}

/** Shannon entropy in bits from observed frequencies. */
export function entropy(values: number[]): number {
  if (values.length === 0) return 0;
  if (!hasFiniteValues(values)) return Number.NaN;

  const counts = new Map<number, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let entropyValue = 0;

  for (const count of counts.values()) {
    const probability = count / values.length;
    entropyValue -= probability * Math.log2(probability);
  }

  return entropyValue;
}

/** Standardized third central moment. */
export function skewness(values: number[]): number {
  if (!hasUsableValues(values)) return Number.NaN;
  if (values.length === 1) return 0;

  const average = mean(values);
  const secondMoment = centralMoment(values, 2, average);

  if (secondMoment === 0) return 0;

  const thirdMoment = centralMoment(values, 3, average);
  return thirdMoment / Math.pow(secondMoment, 1.5);
}

/** Excess kurtosis from the fourth central moment. */
export function kurtosis(values: number[]): number {
  if (!hasUsableValues(values)) return Number.NaN;
  if (values.length === 1) return 0;

  const average = mean(values);
  const secondMoment = centralMoment(values, 2, average);

  if (secondMoment === 0) return 0;

  const fourthMoment = centralMoment(values, 4, average);
  return fourthMoment / (secondMoment * secondMoment) - 3;
}
