import { render, screen } from "@testing-library/react";

import ProtectedRoute from "@/components/auth/protected-route";
import { useAuth } from "@/components/auth/auth-provider";

jest.mock("@/components/auth/auth-provider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/components/auth/login-form", () => ({
  __esModule: true,
  default: () => <div data-testid="login-form">Login</div>,
}));

const mockUseAuth = jest.mocked(useAuth);

describe("ProtectedRoute", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: "1", email: "test@test.com", created_at: "2024-01-01T00:00:00Z" },
      isAuthenticated: true,
      isLoading: false,
      login: jest.fn(),
      logout: jest.fn(),
      register: jest.fn(),
    });
  });

  it("renders children when authenticated", () => {
    render(
      <ProtectedRoute>
        <div>Protected content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
  });

  it("renders login form when unauthenticated", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      login: jest.fn(),
      logout: jest.fn(),
      register: jest.fn(),
    });

    render(
      <ProtectedRoute>
        <div>Protected content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });
});
