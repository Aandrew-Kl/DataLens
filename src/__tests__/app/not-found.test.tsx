import { render, screen } from "@testing-library/react";

import NotFoundPage from "@/app/not-found";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("NotFoundPage", () => {
  it("renders the not found content", () => {
    render(<NotFoundPage />);

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The page you are looking for does not exist or has been moved.",
      ),
    ).toBeInTheDocument();
  });

  it("renders navigation links back into the app", () => {
    render(<NotFoundPage />);

    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("link", { name: "Open dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
