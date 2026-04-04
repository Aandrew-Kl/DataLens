import { render, screen } from "@testing-library/react";

import ProtectedRoute from "@/components/auth/protected-route";
import { useAuth } from "@/components/auth/auth-provider";

jest.mock("@/components/auth/auth-provider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/components/auth/login-form", () => ({
  __esModule: true,
  default: () => <div data-testid="login-form">Login form</div>,
}));

const mockUseAuth = jest.mocked(useAuth);

function createAuthState(overrides: Partial<ReturnType<typeof useAuth>> = {}): ReturnType<typeof useAuth> {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
    register: jest.fn(),
    ...overrides,
  };
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it("renders children when authenticated", () => {
    mockUseAuth.mockReturnValue(createAuthState({
      user: {
        id: "user-1",
        email: "test@example.com",
        created_at: "2024-01-01T00:00:00Z",
      },
      isAuthenticated: true,
    }));

    render(
      <ProtectedRoute>
        <div>Protected content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
  });

  it("renders the login form when not authenticated", () => {
    mockUseAuth.mockReturnValue(createAuthState());

    render(
      <ProtectedRoute>
        <div>Protected content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders a loading indicator while auth state is resolving", () => {
    mockUseAuth.mockReturnValue(createAuthState({ isLoading: true }));

    const { container } = render(
      <ProtectedRoute>
        <div>Protected content</div>
      </ProtectedRoute>,
    );

    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });
});
