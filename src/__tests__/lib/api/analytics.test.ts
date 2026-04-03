import { churnPredict, cohortAnalysis, abTest, forecast } from '@/lib/api/analytics'
import { request } from '@/lib/api/client'

jest.mock('@/lib/api/client', () => ({
  request: jest.fn().mockResolvedValue({}),
}))

describe('analytics API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('churnPredict calls request with correct endpoint', async () => {
    const data = [{ value: 1 }]
    const features = ['feature']
    const target = 'target'

    await churnPredict(data, features, target)

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/analytics/churn-predict', {
      data,
      features,
      target,
    })
  })

  test('cohortAnalysis calls request with correct endpoint', async () => {
    const data = [{ value: 1 }]
    const date_column = 'signup_date'
    const user_column = 'user_id'

    await cohortAnalysis(data, date_column, user_column)

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/analytics/cohort', {
      data,
      date_column,
      user_column,
    })
  })

  test('abTest calls request with correct endpoint', async () => {
    const control = [1]
    const treatment = [2]

    await abTest(control, treatment)

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/analytics/ab-test', {
      control,
      treatment,
    })
  })

  test('forecast calls request with correct endpoint', async () => {
    const data = [{ value: 1 }]
    const date_column = 'date'
    const value_column = 'sales'

    await forecast(data, date_column, value_column, 12)

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/analytics/forecast', {
      data,
      date_column,
      value_column,
      periods: 12,
    })
  })
})
