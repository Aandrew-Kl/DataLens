import { login, register, getMe, logout } from '@/lib/api/auth'

jest.mock('@/lib/api/client', () => ({
  request: jest.fn(),
}))

describe('auth API', () => {
  test('login is a function', () => {
    expect(login).toBeInstanceOf(Function)
  })

  test('register is a function', () => {
    expect(register).toBeInstanceOf(Function)
  })

  test('getMe is a function', () => {
    expect(getMe).toBeInstanceOf(Function)
  })

  test('logout is a function', () => {
    expect(logout).toBeInstanceOf(Function)
  })
})
