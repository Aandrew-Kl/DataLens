import { useUIStore } from "@/stores/ui-store";

describe("useUIStore", () => {
  const darkClassTokens = new Set<string>();

  beforeEach(() => {
    darkClassTokens.clear();
    jest.restoreAllMocks();

    jest.spyOn(document.documentElement.classList, "add").mockImplementation((...tokens: string[]) => {
      tokens.forEach((token) => darkClassTokens.add(token));
    });

    jest
      .spyOn(document.documentElement.classList, "remove")
      .mockImplementation((...tokens: string[]) => {
        tokens.forEach((token) => darkClassTokens.delete(token));
      });

    jest
      .spyOn(document.documentElement.classList, "contains")
      .mockImplementation((token) => darkClassTokens.has(token));

    useUIStore.setState(useUIStore.getInitialState());
  });

  it("has correct initial state", () => {
    const state = useUIStore.getState();

    expect(state.sidebarOpen).toBe(true);
    expect(state.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggles sidebar open state", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("adds dark class and updates theme when setting dark theme", () => {
    useUIStore.getState().setTheme("dark");

    expect(useUIStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class and updates theme when setting light theme", () => {
    useUIStore.getState().setTheme("dark");
    darkClassTokens.add("dark");

    useUIStore.getState().setTheme("light");

    expect(useUIStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggles theme and keeps class list synchronized", () => {
    useUIStore.getState().toggleTheme();

    expect(useUIStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useUIStore.getState().toggleTheme();

    expect(useUIStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("is idempotent when setting the same theme value", () => {
    useUIStore.getState().setTheme("dark");
    useUIStore.getState().setTheme("dark");

    expect(useUIStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
