import { render, screen } from "@testing-library/react";

import RegisterPage from "@/app/register/page";

jest.mock("@/components/auth/register-form", () => ({
  __esModule: true,
  default: () => <div data-testid="register-form" />,
}));

describe("RegisterPage", () => {
  it("renders the RegisterForm component", async () => {
    const page = await RegisterPage({ searchParams: Promise.resolve({}) });

    render(page);

    expect(screen.getByTestId("register-form")).toBeInTheDocument();
  });
});
