import { request } from '@/lib/api/client'
import { sentiment, summarize, generateQuery } from '@/lib/api/ai'

jest.mock('@/lib/api/client', () => ({
  request: jest.fn().mockResolvedValue({}),
}))

const mockedRequest = jest.mocked(request)

describe('ai API', () => {
  beforeEach(() => {
    mockedRequest.mockClear()
  })

  test('sentiment calls request with /api/v1/ai/sentiment', async () => {
    await sentiment(['Example sentence'])

    expect(mockedRequest).toHaveBeenCalledWith('POST', '/api/v1/ai/sentiment', {
      texts: ['Example sentence'],
    })
  })

  test('summarize calls request with /api/v1/ai/summarize', async () => {
    const data = [{ value: 'row one' }]
    const columns = ['value']

    await summarize(data, columns)

    expect(mockedRequest).toHaveBeenCalledWith('POST', '/api/v1/ai/summarize', {
      data,
      columns,
    })
  })

  test('generateQuery calls request with /api/v1/ai/generate-query', async () => {
    const question = 'How many rows?'
    const tableName = 'events'
    const columns = [{ name: 'id', type: 'number' }]

    await generateQuery(question, tableName, columns)

    expect(mockedRequest).toHaveBeenCalledWith('POST', '/api/v1/ai/generate-query', {
      question,
      table_name: tableName,
      columns,
    })
  })
})
