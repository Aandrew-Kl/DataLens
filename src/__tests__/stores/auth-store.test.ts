import { useAuthStore } from '../../stores/auth-store';

describe('useAuthStore', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
    useAuthStore.getState().clearToken();
  });

  it('has initial state with null token', () => {
    const { token, isAuthenticated } = useAuthStore.getState();

    expect(token).toBeNull();
    expect(isAuthenticated).toBe(false);
  });

  it('setToken stores token and sets isAuthenticated', () => {
    const token = 'abc123';

    useAuthStore.getState().setToken(token);

    const { token: storedToken, isAuthenticated } = useAuthStore.getState();
    expect(storedToken).toBe(token);
    expect(isAuthenticated).toBe(true);

    if (typeof window !== 'undefined') {
      expect(window.localStorage.getItem('datalens_token')).toBe(token);
    }
  });

  it('clearToken removes token', () => {
    useAuthStore.getState().setToken('abc123');
    useAuthStore.getState().clearToken();

    const { token, isAuthenticated } = useAuthStore.getState();
    expect(token).toBeNull();
    expect(isAuthenticated).toBe(false);

    if (typeof window !== 'undefined') {
      expect(window.localStorage.getItem('datalens_token')).toBeNull();
    }
  });
});
