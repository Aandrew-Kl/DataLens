import { renderHook } from "@testing-library/react";

import { useDarkMode } from "@/lib/hooks/use-dark-mode";

describe("useDarkMode", () => {
  it("returns false when dark class is not present", () => {
    document.documentElement.classList.remove("dark");

    const { result } = renderHook(() => useDarkMode());

    expect(result.current).toBe(false);
  });

  describe("when dark class is present", () => {
    beforeEach(() => {
      document.documentElement.classList.add("dark");
    });

    afterEach(() => {
      document.documentElement.classList.remove("dark");
    });

    it("returns true when dark class is present", () => {
      const { result } = renderHook(() => useDarkMode());

      expect(result.current).toBe(true);
    });
  });
});
