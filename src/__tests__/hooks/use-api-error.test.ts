import { act, renderHook } from '@testing-library/react';

import { useApiError } from '@/hooks/use-api-error';

describe('useApiError', () => {
  it('initial state has null error', () => {
    const { result } = renderHook(() => useApiError());

    expect(result.current.error).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('handleError sets error from Error instance', () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError(new Error('Something broke'));
    });

    expect(result.current.error).toBe('Something broke');
    expect(result.current.isError).toBe(true);
  });

  it('handleError sets error from object with message', () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError({ message: 'Object error message' });
    });

    expect(result.current.error).toBe('Object error message');
    expect(result.current.isError).toBe(true);
  });

  it('handleError sets default message for unknown types', () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError(42);
    });

    expect(result.current.error).toBe('An unexpected error occurred.');
    expect(result.current.isError).toBe(true);
  });

  it('clearError resets error to null', () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError(new Error('Temporary'));
    });

    expect(result.current.error).toBe('Temporary');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});
