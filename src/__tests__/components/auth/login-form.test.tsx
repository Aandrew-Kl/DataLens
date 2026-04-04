import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LoginForm from "@/components/auth/login-form";
import { login } from "@/lib/api/auth";

jest.mock("@/lib/api/auth", () => ({
  login: jest.fn(),
}));

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock("framer-motion");

const mockLogin = jest.mocked(login);

describe("LoginForm", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    pushMock.mockReset();
  });

  it("renders email and password inputs and login button", () => {
    render(<LoginForm />);

    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows error message on failed login", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new Error("Invalid credentials"));

    render(<LoginForm />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Enter your password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user@example.com", "wrongpass");
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
    });
  });

  it("calls login() with correct email and password on submit", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      access_token: "token-123",
      token_type: "bearer",
    });

    render(<LoginForm />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Enter your password"), "strong-pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user@example.com", "strong-pass");
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });
});
