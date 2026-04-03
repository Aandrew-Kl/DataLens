import type {
  ABTestResult,
  AuthToken,
  CohortResult,
  ForecastResult,
  PCAResult,
  QueryGenerateResult,
  SummarizeResult,
  UserInfo,
  AnomalyResult,
} from '@/lib/api/types';

describe('API type contracts', () => {
  it('AnomalyResult has labels and scores', () => {
    const result = {
      labels: [0, 1, 0],
      scores: [0.12, 0.84, 0.39],
    } satisfies AnomalyResult;

    expect(result.labels).toHaveLength(3);
    expect(result.scores).toHaveLength(3);
  });

  it('PCAResult has explained_variance, loadings, and transformed', () => {
    const result = {
      explained_variance: [0.6, 0.3, 0.1],
      loadings: [[0.8, 0.1], [0.2, 0.9]],
      transformed: [[1.2, -0.4], [0.7, 0.1]],
    } satisfies PCAResult;

    expect(result.explained_variance).toHaveLength(3);
    expect(result.loadings).toHaveLength(2);
    expect(result.transformed).toHaveLength(2);
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

  it('SummarizeResult has summary, top_terms, and stats', () => {
    const result = {
      summary: 'Stable behavior.',
      top_terms: [{ term: 'trend', score: 0.91 }],
      stats: { coverage: { count: 120, mean: 0.45 } },
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

  it('CohortResult has cohorts', () => {
    const result = {
      cohorts: { control: { users: 540, conversion: 0.11 } },
    } satisfies CohortResult;

    expect(Object.keys(result.cohorts)).toHaveLength(1);
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
});
