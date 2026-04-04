import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AuthProvider, { useAuth } from "@/components/auth/auth-provider";
import { getMe, login, logout, register } from "@/lib/api/auth";
import type { UserInfo } from "@/lib/api/types";

jest.mock("@/lib/api/auth", () => ({
  getMe: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  register: jest.fn(),
}));

const mockGetMe = jest.mocked(getMe);
const mockLogin = jest.mocked(login);
const mockLogout = jest.mocked(logout);
const mockRegister = jest.mocked(register);

const TEST_USER: UserInfo = {
  id: "user-1",
  email: "test@example.com",
  created_at: "2024-01-01T00:00:00Z",
};

function AuthStateProbe() {
  const {
    user,
    isAuthenticated,
    isLoading,
    login: contextLogin,
    logout: contextLogout,
    register: contextRegister,
  } = useAuth();

  return (
    <div>
      <span>{`authenticated-${isAuthenticated}`}</span>
      <span>{`loading-${isLoading}`}</span>
      <span>{`email-${user?.email ?? "none"}`}</span>
      <span>{`login-${typeof contextLogin}`}</span>
      <span>{`logout-${typeof contextLogout}`}</span>
      <span>{`register-${typeof contextRegister}`}</span>
      <button type="button" onClick={() => void contextLogin("test@example.com", "strong-pass")}>
        Trigger login
      </button>
      <button type="button" onClick={() => contextLogout()}>
        Trigger logout
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockGetMe.mockReset();
    mockLogin.mockReset();
    mockLogout.mockReset();
    mockRegister.mockReset();
  });

  it("renders children", () => {
    render(
      <AuthProvider>
        <div>Child content</div>
      </AuthProvider>,
    );

    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("provides auth context", async () => {
    window.localStorage.setItem("datalens_token", "unit-token");
    mockGetMe.mockResolvedValue(TEST_USER);

    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      expect(screen.getByText("authenticated-true")).toBeInTheDocument();
      expect(screen.getByText("loading-false")).toBeInTheDocument();
      expect(screen.getByText("email-test@example.com")).toBeInTheDocument();
    });

    expect(screen.getByText("login-function")).toBeInTheDocument();
    expect(screen.getByText("logout-function")).toBeInTheDocument();
    expect(screen.getByText("register-function")).toBeInTheDocument();
  });

  it("throws when useAuth is used outside the provider", () => {
    expect(() => render(<AuthStateProbe />)).toThrow("useAuth must be used within an AuthProvider");
  });

  it("stays unauthenticated when no stored token is present", async () => {
    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("authenticated-false")).toBeInTheDocument();
      expect(screen.getByText("loading-false")).toBeInTheDocument();
      expect(screen.getByText("email-none")).toBeInTheDocument();
    });

    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("logs out and clears auth state when token hydration fails", async () => {
    window.localStorage.setItem("datalens_token", "expired-token");
    mockGetMe.mockRejectedValue(new Error("Session expired"));

    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(screen.getByText("authenticated-false")).toBeInTheDocument();
      expect(screen.getByText("loading-false")).toBeInTheDocument();
      expect(screen.getByText("email-none")).toBeInTheDocument();
    });
  });

  it("handles login and logout through the auth context", async () => {
    const user = userEvent.setup();

    mockLogin.mockResolvedValue({
      access_token: "token-123",
      token_type: "bearer",
    });
    mockGetMe.mockResolvedValue(TEST_USER);

    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("loading-false")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Trigger login" }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("test@example.com", "strong-pass");
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      expect(screen.getByText("authenticated-true")).toBeInTheDocument();
      expect(screen.getByText("email-test@example.com")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Trigger logout" }));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(screen.getByText("authenticated-false")).toBeInTheDocument();
      expect(screen.getByText("email-none")).toBeInTheDocument();
    });
  });
});
