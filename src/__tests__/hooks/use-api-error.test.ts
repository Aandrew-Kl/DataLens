import { act, renderHook } from "@testing-library/react";

import { useApiError } from "@/hooks/use-api-error";

describe("useApiError", () => {
  it("starts without an error", () => {
    const { result } = renderHook(() => useApiError());

    expect(result.current.error).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("captures messages from Error instances", () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError(new Error("Something broke"));
    });

    expect(result.current.error).toBe("Something broke");
    expect(result.current.isError).toBe(true);
  });

  it("captures messages from objects with string messages", () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError({ message: "Object error message" });
    });

    expect(result.current.error).toBe("Object error message");
    expect(result.current.isError).toBe(true);
  });

  it("stringifies non-string message values from error-like objects", () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError({ message: 404 });
    });

    expect(result.current.error).toBe("404");
    expect(result.current.isError).toBe(true);
  });

  it("falls back to the default message for null and primitive values", () => {
    const { result } = renderHook(() => useApiError());

    act(() => {
      result.current.handleError(42);
    });

    expect(result.current.error).toBe("An unexpected error occurred.");
    expect(result.current.isError).toBe(true);

    act(() => {
      result.current.handleError(null);
    });

    expect(result.current.error).toBe("An unexpected error occurred.");
  });

  it("clears the current error and keeps callback references stable", () => {
    const { result, rerender } = renderHook(() => useApiError());
    const initialHandleError = result.current.handleError;
    const initialClearError = result.current.clearError;

    act(() => {
      result.current.handleError(new Error("Temporary"));
    });

    rerender();

    expect(result.current.handleError).toBe(initialHandleError);
    expect(result.current.clearError).toBe(initialClearError);

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});
