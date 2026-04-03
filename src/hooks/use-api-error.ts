'use client';
import { useState, useCallback } from 'react';

export interface ApiErrorState {
  error: string | null;
  isError: boolean;
  clearError: () => void;
  handleError: (err: unknown) => void;
}

export function useApiError(): ApiErrorState {
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof Error) {
      setError(err.message);
    } else if (typeof err === 'object' && err !== null && 'message' in err) {
      setError(String((err as Record<string, unknown>).message));
    } else {
      setError('An unexpected error occurred.');
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { error, isError: error !== null, clearError, handleError };
}
