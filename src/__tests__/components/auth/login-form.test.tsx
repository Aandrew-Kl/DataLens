import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";

import LoginForm from "@/components/auth/login-form";
import { login } from "@/lib/api/auth";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/api/auth", () => ({
  login: jest.fn(),
}));

const mockLogin = jest.mocked(login);
const mockUseRouter = jest.mocked(useRouter);
const pushMock = jest.fn();

describe("LoginForm", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    pushMock.mockReset();
    mockUseRouter.mockReturnValue({
      push: pushMock,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("renders the login form fields and navigation link", () => {
    render(<LoginForm />);

    expect(screen.getByRole("heading", { level: 2, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /register/i })).toHaveAttribute("href", "/register");
  });

  it("shows an error when login fails", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new Error("Invalid credentials"));

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user@example.com", "wrongpass");
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
    });
  });

  it("calls login() and redirects on submit", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      access_token: "token-123",
      token_type: "bearer",
    });

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "strong-pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user@example.com", "strong-pass");
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });
});
