import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("LoginForm", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    pushMock.mockReset();
    mockUseRouter.mockReturnValue({
      push: pushMock,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("renders the login form fields and navigation link", () => {
    render(<LoginForm redirectTo="/dashboard?view=recent" />);

    expect(screen.getByRole("heading", { level: 2, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /register/i })).toHaveAttribute(
      "href",
      "/register?redirect=%2Fdashboard%3Fview%3Drecent",
    );
  });

  it("prevents submission when the email is empty", () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const submitButton = screen.getByRole("button", { name: /sign in/i });

    fireEvent.click(submitButton);

    expect(emailInput).toBeInvalid();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("prevents submission when the password is empty", async () => {
    const user = userEvent.setup();

    render(<LoginForm />);

    const passwordInput = screen.getByLabelText(/password/i);
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(passwordInput).toBeInvalid();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("prevents submission when the email format is invalid", async () => {
    const user = userEvent.setup();

    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "strong-pass");
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(emailInput).toBeInvalid();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a loading state while the login request is in flight", async () => {
    const user = userEvent.setup();
    const pendingLogin = createDeferred<{ access_token: string; token_type: string }>();

    mockLogin.mockReturnValue(pendingLogin.promise);

    render(<LoginForm redirectTo="/dashboard" />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "strong-pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(mockLogin).toHaveBeenCalledWith("user@example.com", "strong-pass");
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();

    pendingLogin.resolve({
      access_token: "token-123",
      token_type: "bearer",
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows an error when login fails", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue({ message: "Invalid credentials" });

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user@example.com", "wrongpass");
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
      });
  });

  it("calls the login API and redirects on success", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      access_token: "token-123",
      token_type: "bearer",
    });

    render(<LoginForm redirectTo="/reports?tab=saved" />);

    await user.type(screen.getByLabelText(/email/i), "  user@example.com  ");
    await user.type(screen.getByLabelText(/password/i), "strong-pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user@example.com", "strong-pass");
      expect(pushMock).toHaveBeenCalledWith("/reports?tab=saved");
    });
  });
});
