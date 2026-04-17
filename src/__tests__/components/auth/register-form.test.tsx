import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";

import RegisterForm from "@/components/auth/register-form";
import { register } from "@/lib/api/auth";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/api/auth", () => ({
  register: jest.fn(),
}));

const mockRegister = jest.mocked(register);
const mockUseRouter = jest.mocked(useRouter);
const pushMock = jest.fn();

describe("RegisterForm", () => {
  beforeEach(() => {
    mockRegister.mockReset();
    pushMock.mockReset();
    mockUseRouter.mockReturnValue({
      push: pushMock,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("renders the registration form fields and login link", () => {
    render(<RegisterForm redirectTo="/dashboard?view=saved" />);

    expect(screen.getByRole("heading", { level: 2, name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /login/i })).toHaveAttribute(
      "href",
      "/login?redirect=%2Fdashboard%3Fview%3Dsaved",
    );
  });

  it("shows a validation error when the password is too short", async () => {
    const user = userEvent.setup();

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "short");
    await user.type(screen.getByLabelText(/confirm password/i), "short");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Password must be at least 8 characters long.");
    expect(mockRegister).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a validation error when the password has no uppercase letter", async () => {
    const user = userEvent.setup();

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "lowercase1");
    await user.type(screen.getByLabelText(/confirm password/i), "lowercase1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password must contain at least one uppercase letter.",
    );
    expect(mockRegister).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a validation error when the password has no lowercase letter", async () => {
    const user = userEvent.setup();

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "UPPERCASE1");
    await user.type(screen.getByLabelText(/confirm password/i), "UPPERCASE1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password must contain at least one lowercase letter.",
    );
    expect(mockRegister).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a validation error when the password has no digit", async () => {
    const user = userEvent.setup();

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "NoDigitsHere");
    await user.type(screen.getByLabelText(/confirm password/i), "NoDigitsHere");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Password must contain at least one digit.");
    expect(mockRegister).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a validation error when the passwords do not match", async () => {
    const user = userEvent.setup();

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "ValidPass1");
    await user.type(screen.getByLabelText(/confirm password/i), "Different1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(mockRegister).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows an API error when registration fails", async () => {
    const user = userEvent.setup();
    mockRegister.mockRejectedValue(new Error("Email already exists"));

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "ValidPass1");
    await user.type(screen.getByLabelText(/confirm password/i), "ValidPass1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith("new-user@example.com", "ValidPass1");
      expect(screen.getByRole("alert")).toHaveTextContent("Email already exists");
    });
  });

  it("submits registration successfully, shows confirmation, and redirects", async () => {
    const user = userEvent.setup();
    mockRegister.mockResolvedValue({
      id: "user-123",
      email: "new-user@example.com",
      created_at: "2026-04-18T00:00:00Z",
      access_token: "token-123",
      token_type: "bearer",
      user: {
        id: "user-123",
        email: "new-user@example.com",
        created_at: "2026-04-18T00:00:00Z",
      },
    });

    render(<RegisterForm redirectTo="/workspace" />);

    await user.type(screen.getByLabelText(/email/i), "  new-user@example.com  ");
    await user.type(screen.getByLabelText(/^password$/i), "ValidPass1");
    await user.type(screen.getByLabelText(/confirm password/i), "ValidPass1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith("new-user@example.com", "ValidPass1");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your account has been created. Redirecting to dashboard...",
      );
      expect(pushMock).toHaveBeenCalledWith("/workspace");
    });
  });
});
