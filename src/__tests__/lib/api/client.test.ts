import { request, uploadFile } from '@/lib/api/client'

describe('api client', () => {
  test('request is a function', () => {
    expect(request).toBeInstanceOf(Function)
  })

  test('uploadFile is a function', () => {
    expect(uploadFile).toBeInstanceOf(Function)
  })
})
