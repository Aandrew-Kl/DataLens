import { regression, cluster, classify, anomalyDetect, pca } from '@/lib/api/ml'
import { request } from '@/lib/api/client'

jest.mock('@/lib/api/client', () => ({
  request: jest.fn().mockResolvedValue({}),
}))

describe('ml API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('regression calls request with correct endpoint', async () => {
    const data = [{ x: 1 }]
    const target = 'y'
    const features = ['x']

    await regression(data, target, features, 'linear')

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/ml/regression', {
      data,
      target,
      features,
      method: 'linear',
    })
  })

  test('cluster calls request with correct endpoint', async () => {
    const data = [{ x: 1 }]
    const features = ['x']

    await cluster(data, features, 'kmeans', 3)

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/ml/cluster', {
      data,
      features,
      method: 'kmeans',
      n_clusters: 3,
    })
  })

  test('classify calls request with correct endpoint', async () => {
    const data = [{ x: 1 }]
    const target = 'label'
    const features = ['x']

    await classify(data, target, features, 'random_forest')

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/ml/classify', {
      data,
      target,
      features,
      method: 'random_forest',
    })
  })

  test('anomalyDetect calls request with correct endpoint', async () => {
    const data = [{ x: 1 }]
    const features = ['x']

    await anomalyDetect(data, features, 'isolation_forest', 0.1)

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/ml/anomaly-detect', {
      data,
      features,
      method: 'isolation_forest',
      contamination: 0.1,
    })
  })

  test('pca calls request with correct endpoint', async () => {
    const data = [{ x: 1 }]
    const features = ['x']

    await pca(data, features, 2)

    expect(jest.mocked(request)).toHaveBeenCalledWith('POST', '/api/v1/ml/pca', {
      data,
      features,
      n_components: 2,
    })
  })
})
