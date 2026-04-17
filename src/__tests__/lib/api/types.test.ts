import type {
  ABTestResult,
  AuthToken,
  CohortResult,
  ForecastResult,
  PCAResult,
  QueryGenerateResult,
  RegisterResponse,
  SummarizeResult,
  UserInfo,
  AnomalyResult,
} from '@/lib/api/types';

describe('API type contracts', () => {
  it('AnomalyResult has labels and scores', () => {
    const result = {
      algorithm: 'isolation_forest',
      row_count: 3,
      labels: [0, 1, 0],
      anomaly_scores: [0.12, 0.84, 0.39],
      anomaly_count: 1,
    } satisfies AnomalyResult;

    expect(result.labels).toHaveLength(3);
    expect(result.anomaly_scores).toHaveLength(3);
  });

  it('PCAResult has explained_variance, loadings, and transformed', () => {
    const result = {
      row_count: 2,
      explained_variance_ratio: [0.6, 0.3, 0.1],
      loadings: [
        { component: 'PC1', feature_a: 0.8, feature_b: 0.1 },
        { component: 'PC2', feature_a: 0.2, feature_b: 0.9 },
      ],
      transformed_data: [[1.2, -0.4], [0.7, 0.1]],
    } satisfies PCAResult;

    expect(result.explained_variance_ratio).toHaveLength(3);
    expect(result.loadings).toHaveLength(2);
    expect(result.transformed_data).toHaveLength(2);
  });

  it('ABTestResult has p_value, confidence_interval, effect_size, significant', () => {
    const result = {
      p_value: 0.043,
      confidence_interval: [0.12, 0.58] as [number, number],
      effect_size: 0.35,
      significant: true,
    } satisfies ABTestResult;

    expect(result.significant).toBe(true);
    expect(result.confidence_interval).toHaveLength(2);
  });

  it('SummarizeResult has summary_text, top_terms, and key_statistics', () => {
    const result = {
      dataset_id: 7,
      summary_text: 'Stable behavior.',
      top_terms: [{ term: 'trend', score: 0.91 }],
      key_statistics: { coverage: { count: 120, mean: 0.45 } },
    } satisfies SummarizeResult;

    expect(result.top_terms).toHaveLength(1);
  });

  it('UserInfo has id, email, and created_at', () => {
    const result = {
      id: 'user_123',
      email: 'analyst@example.com',
      created_at: '2026-04-03T00:00:00Z',
    } satisfies UserInfo;

    expect(result.id).toBe('user_123');
  });

  it('ForecastResult has predictions and model', () => {
    const result = {
      predictions: [{ date: '2026-04-04', value: 102.3 }],
      model: 'auto-arima',
    } satisfies ForecastResult;

    expect(result.predictions).toHaveLength(1);
  });

  it('CohortResult has retention_rows and summaries', () => {
    const result = {
      total_users: 540,
      cohort_count: 1,
      retention_rows: [
        {
          cohort_period: '2026-01',
          period_index: 0,
          cohort_size: 540,
          retained_users: 540,
          retention_rate: 100,
        },
      ],
      summaries: [
        {
          cohort_period: '2026-01',
          cohort_size: 540,
          max_period_index: 3,
          first_period_retention: 72.5,
        },
      ],
    } satisfies CohortResult;

    expect(result.retention_rows).toHaveLength(1);
    expect(result.summaries).toHaveLength(1);
  });

  it('QueryGenerateResult has sql and explanation', () => {
    const result = {
      sql: 'SELECT * FROM events',
      explanation: 'Returns all events.',
    } satisfies QueryGenerateResult;

    expect(result.sql).toContain('SELECT');
  });

  it('AuthToken has access_token and token_type', () => {
    const result = {
      access_token: 'eyJtoken',
      token_type: 'Bearer',
    } satisfies AuthToken;

    expect(result.token_type).toBe('Bearer');
  });

  it('RegisterResponse includes token fields and user details', () => {
    const result = {
      id: 'user_123',
      email: 'analyst@example.com',
      created_at: '2026-04-03T00:00:00Z',
      access_token: 'eyJtoken',
      token_type: 'bearer',
      user: {
        id: 'user_123',
        email: 'analyst@example.com',
        created_at: '2026-04-03T00:00:00Z',
      },
    } satisfies RegisterResponse;

    expect(result.user.email).toBe('analyst@example.com');
  });
});
