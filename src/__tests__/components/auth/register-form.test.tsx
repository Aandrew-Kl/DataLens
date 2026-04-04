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
    render(<RegisterForm />);

    expect(screen.getByRole("heading", { level: 2, name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /login/i })).toHaveAttribute("href", "/login");
  });

  it("shows an error when register fails", async () => {
    const user = userEvent.setup();
    mockRegister.mockRejectedValue(new Error("Email already exists"));

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "long-password");
    await user.type(screen.getByLabelText(/confirm password/i), "long-password");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith("new-user@example.com", "long-password");
      expect(screen.getByRole("alert")).toHaveTextContent("Email already exists");
    });
  });

  it("calls register() and redirects on submit", async () => {
    const user = userEvent.setup();
    mockRegister.mockResolvedValue({
      access_token: "token-123",
      token_type: "bearer",
    });

    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "new-user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "long-password");
    await user.type(screen.getByLabelText(/confirm password/i), "long-password");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith("new-user@example.com", "long-password");
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });
});
