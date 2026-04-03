import { render, screen } from "@testing-library/react";

import RegisterPage from "@/app/register/page";

jest.mock("@/components/auth/register-form", () => ({
  __esModule: true,
  default: () => <div data-testid="register-form" />,
}));

describe("RegisterPage", () => {
  it("renders the RegisterForm component", () => {
    render(<RegisterPage />);

    expect(screen.getByTestId("register-form")).toBeInTheDocument();
  });
});
