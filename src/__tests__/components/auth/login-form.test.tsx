import { act, render, screen, waitFor } from "@testing-library/react";
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

async function renderAsync(): Promise<void> {
  await act(async () => {
    render(<LoginForm />);
  });
}

describe("LoginForm", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    pushMock.mockReset();
  });

  it("renders email and password fields", async () => {
    await renderAsync();

    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your password")).toBeInTheDocument();
  });

  it("shows error on failed login", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new Error("Invalid credentials"));

    await renderAsync();

    await user.type(screen.getByPlaceholderText("you@example.com"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Enter your password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
    expect(mockLogin).toHaveBeenCalledWith("user@example.com", "wrongpass");
  });

  it("calls login() on submit", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      access_token: "token-123",
      token_type: "bearer",
    });

    await renderAsync();

    await user.type(screen.getByPlaceholderText("you@example.com"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Enter your password"), "strong-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user@example.com", "strong-pass");
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });
});
