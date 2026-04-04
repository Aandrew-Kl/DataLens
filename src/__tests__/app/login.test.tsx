import { render, screen } from "@testing-library/react";

import LoginPage from "@/app/login/page";

jest.mock("next/font/google", () => ({
  Inter: jest.fn(() => ({ variable: "--font" })),
  Geist: jest.fn(() => ({ variable: "--font" })),
  Geist_Mono: jest.fn(() => ({ variable: "--font" })),
}));

jest.mock("@/components/auth/login-form", () => ({
  __esModule: true,
  default: () => <div data-testid="login-form" />,
}));

describe("LoginPage", () => {
  it("renders the LoginForm component", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    render(page);

    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });
});
