import { render, screen, waitFor } from "@testing-library/react";

import AuthProvider, { useAuth } from "@/components/auth/auth-provider";
import { getMe, login, logout, register } from "@/lib/api/auth";

jest.mock("@/lib/api/auth", () => ({
  getMe: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  register: jest.fn(),
}));

const mockGetMe = jest.mocked(getMe);

function AuthStateProbe() {
  const { user, isAuthenticated, isLoading, login: contextLogin, logout: contextLogout, register: contextRegister } = useAuth();

  return (
    <div>
      <span>{`authenticated-${isAuthenticated}`}</span>
      <span>{`loading-${isLoading}`}</span>
      <span>{`email-${user?.email ?? "none"}`}</span>
      <span>{`login-${typeof contextLogin}`}</span>
      <span>{`logout-${typeof contextLogout}`}</span>
      <span>{`register-${typeof contextRegister}`}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockGetMe.mockReset();
    jest.mocked(login).mockReset();
    jest.mocked(logout).mockReset();
    jest.mocked(register).mockReset();
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
    mockGetMe.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      created_at: "2024-01-01T00:00:00Z",
    });

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
});
