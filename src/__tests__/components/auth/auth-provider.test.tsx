import { act, render, screen, waitFor } from "@testing-library/react";
import AuthProvider, { useAuth } from "@/components/auth/auth-provider";
import { getMe } from "@/lib/api/auth";

jest.mock("@/lib/api/auth", () => ({
  getMe: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  register: jest.fn(),
}));

jest.mock("framer-motion");

const mockGetMe = jest.mocked(getMe);

function AuthStateProbe() {
  const { user, isAuthenticated, isLoading } = useAuth();

  return (
    <div>
      <span>{`loading-${isLoading}`}</span>
      <span>{`authenticated-${isAuthenticated}`}</span>
      <span>{`email-${user?.email ?? "none"}`}</span>
    </div>
  );
}

async function renderAsync() {
  await act(async () => {
    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );
  });
}

describe("AuthProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockGetMe.mockReset();
  });

  it("provides auth context", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByText("loading-false")).toBeInTheDocument();
      expect(screen.getByText("authenticated-false")).toBeInTheDocument();
      expect(screen.getByText("email-none")).toBeInTheDocument();
    });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("checks token on mount", async () => {
    const user = {
      id: "user-1",
      email: "test@example.com",
      created_at: "2024-01-01T00:00:00Z",
    };
    window.localStorage.setItem("datalens_token", "unit-token");
    mockGetMe.mockResolvedValue(user);

    await renderAsync();

    await waitFor(() => {
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      expect(screen.getByText("authenticated-true")).toBeInTheDocument();
      expect(screen.getByText("email-test@example.com")).toBeInTheDocument();
    });
    expect(screen.getByText("loading-false")).toBeInTheDocument();
  });
});
