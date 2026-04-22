export interface HistogramBin {
  label: string;
  count: number;
}

export interface FrequencyRow {
  value: string;
  count: number;
  percentage: number;
}

export interface ColumnStatistics {
  count: number;
  nulls: number;
  unique: number;
  min: string | number | null;
  max: string | number | null;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  variance: number | null;
  skewness: number | null;
  kurtosis: number | null;
}

export interface PatternMetrics {
  nonNull: number;
  emailCount: number;
  phoneCount: number;
  urlCount: number;
  blankCount: number;
  trimmedCount: number;
}

export interface TemporalGap {
  start: string;
  end: string;
  days: number;
}

export interface TemporalMetrics {
  minDate: string | null;
  maxDate: string | null;
  rangeDays: number;
  dayOfWeek: HistogramBin[];
  gaps: TemporalGap[];
}

export interface OutlierMetrics {
  q1: number | null;
  median: number | null;
  q3: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  whiskerLow: number | null;
  whiskerHigh: number | null;
  outlierCount: number;
  topOutliers: FrequencyRow[];
}

export interface QualityMetrics {
  completeness: number;
  uniqueness: number;
  patternConformity: number;
  conformityLabel: string;
}

export interface AdvancedProfileData {
  statistics: ColumnStatistics;
  histogram: HistogramBin[];
  frequencyRows: FrequencyRow[];
  patterns: PatternMetrics | null;
  temporal: TemporalMetrics | null;
  outliers: OutlierMetrics | null;
  quality: QualityMetrics;
}

export interface LoadState {
  key: string;
  data: AdvancedProfileData | null;
  error: string | null;
}

export const EASE = [0.22, 1, 0.36, 1] as const;
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
