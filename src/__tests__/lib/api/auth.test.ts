import { getMe, login, logout, register } from "@/lib/api/auth";
import { request } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth-store";

jest.mock("@/lib/api/client", () => ({
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);

describe("auth API", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    window.localStorage.clear();
    useAuthStore.setState({ token: null, isAuthenticated: false });
  });

  test("login sends the correct payload and stores the returned token", async () => {
    const authToken = {
      access_token: "login-token",
      token_type: "bearer",
    };
    mockedRequest.mockResolvedValue(authToken);

    await expect(login("person@example.com", "secret")).resolves.toEqual(authToken);

    expect(mockedRequest).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      email: "person@example.com",
      password: "secret",
    });
    expect(useAuthStore.getState().token).toBe("login-token");
    expect(window.localStorage.getItem("datalens_token")).toBe("login-token");
  });

  test("register sends the correct payload and stores the returned token", async () => {
    const registerResponse = {
      id: "user-123",
      email: "new@example.com",
      created_at: "2026-04-18T00:00:00Z",
      access_token: "register-token",
      token_type: "bearer",
      user: {
        id: "user-123",
        email: "new@example.com",
        created_at: "2026-04-18T00:00:00Z",
      },
    };
    mockedRequest.mockResolvedValue(registerResponse);

    await expect(register("new@example.com", "new-secret")).resolves.toEqual(registerResponse);

    expect(mockedRequest).toHaveBeenCalledWith("POST", "/api/v1/auth/register", {
      email: "new@example.com",
      password: "new-secret",
    });
    expect(useAuthStore.getState().token).toBe("register-token");
    expect(window.localStorage.getItem("datalens_token")).toBe("register-token");
  });

  test("getMe loads the current user", async () => {
    const me = {
      id: "user-1",
      email: "person@example.com",
      created_at: "2026-01-01T00:00:00Z",
    };
    mockedRequest.mockResolvedValue(me);

    await expect(getMe()).resolves.toEqual(me);

    expect(mockedRequest).toHaveBeenCalledWith("GET", "/api/v1/auth/me");
  });

  test("logout clears the current token", () => {
    useAuthStore.getState().setToken("logout-token");

    logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(window.localStorage.getItem("datalens_token")).toBeNull();
  });

  test.each([
    { name: "login", action: login, path: "/api/v1/auth/login" },
    { name: "register", action: register, path: "/api/v1/auth/register" },
  ])("propagates $name error responses without persisting a token", async ({ action, path }) => {
    const error = {
      status: 400,
      message: "Invalid credentials",
    };
    mockedRequest.mockRejectedValue(error);

    await expect(action("person@example.com", "bad-password")).rejects.toBe(error);

    expect(mockedRequest).toHaveBeenCalledWith("POST", path, {
      email: "person@example.com",
      password: "bad-password",
    });
    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem("datalens_token")).toBeNull();
  });
});
