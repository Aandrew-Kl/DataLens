import { useAuthStore } from "@/stores/auth-store";

describe("auth-store", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
    useAuthStore.setState(useAuthStore.getInitialState());
  });

  it("has correct initial state", () => {
    const state = useAuthStore.getState();

    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it("login sets token and authenticated state", () => {
    useAuthStore.getState().setToken("jwt-token-1");

    const state = useAuthStore.getState();

    expect(state.token).toBe("jwt-token-1");
    expect(state.isAuthenticated).toBe(true);
  });

  it("logout clears token and authenticated state", () => {
    useAuthStore.getState().setToken("jwt-token-1");
    useAuthStore.getState().clearToken();

    const state = useAuthStore.getState();

    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it("setToken updates only token and keeps authenticated state true", () => {
    useAuthStore.getState().setToken("jwt-token-1");
    useAuthStore.getState().setToken("jwt-token-2");

    const state = useAuthStore.getState();

    expect(state.token).toBe("jwt-token-2");
    expect(state.isAuthenticated).toBe(true);
  });

  it("supports multiple login and logout cycles", () => {
    useAuthStore.getState().setToken("jwt-token-1");
    expect(useAuthStore.getState()).toMatchObject({
      token: "jwt-token-1",
      isAuthenticated: true,
    });

    useAuthStore.getState().clearToken();
    expect(useAuthStore.getState()).toMatchObject({
      token: null,
      isAuthenticated: false,
    });

    useAuthStore.getState().setToken("jwt-token-2");
    expect(useAuthStore.getState()).toMatchObject({
      token: "jwt-token-2",
      isAuthenticated: true,
    });

    useAuthStore.getState().clearToken();
    expect(useAuthStore.getState()).toMatchObject({
      token: null,
      isAuthenticated: false,
    });
  });
});
