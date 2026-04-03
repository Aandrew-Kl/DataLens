import { useUIStore } from "@/stores/ui-store";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({
      sidebarOpen: true,
      theme: "light",
    });
    document.documentElement.classList.remove("dark");
  });

  it("toggles the sidebar open state", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("sets the dark theme and applies the dark class", () => {
    useUIStore.getState().setTheme("dark");

    expect(useUIStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("sets the light theme and removes the dark class", () => {
    document.documentElement.classList.add("dark");

    useUIStore.getState().setTheme("light");

    expect(useUIStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggles between light and dark themes while updating the DOM class", () => {
    useUIStore.getState().toggleTheme();

    expect(useUIStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useUIStore.getState().toggleTheme();

    expect(useUIStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
