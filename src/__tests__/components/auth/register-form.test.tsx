import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RegisterForm from "@/components/auth/register-form";
import { register } from "@/lib/api/auth";

jest.mock("@/lib/api/auth", () => ({
  register: jest.fn(),
}));

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock("framer-motion");

const mockRegister = jest.mocked(register);

describe("RegisterForm", () => {
  beforeEach(() => {
    mockRegister.mockReset();
    pushMock.mockReset();
  });

  it("renders email, password, and confirm password inputs", () => {
    render(<RegisterForm />);

    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Minimum 8 characters")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Repeat your password")).toBeInTheDocument();
  });

  it("shows validation error when passwords do not match", async () => {
    const user = userEvent.setup();

    render(<RegisterForm />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "new-user@example.com");
    await user.type(screen.getByPlaceholderText("Minimum 8 characters"), "long-password");
    await user.type(screen.getByPlaceholderText("Repeat your password"), "different-password");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  it("calls register() with valid form input", async () => {
    const user = userEvent.setup();
    mockRegister.mockResolvedValue({
      access_token: "token-123",
      token_type: "bearer",
    });

    render(<RegisterForm />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "new-user@example.com");
    await user.type(screen.getByPlaceholderText("Minimum 8 characters"), "long-password");
    await user.type(screen.getByPlaceholderText("Repeat your password"), "long-password");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith("new-user@example.com", "long-password");
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });
});
