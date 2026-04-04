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
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The page you were looking for doesn't exist or is no longer available.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Return to a safe route and keep exploring your datasets."),
    ).toBeInTheDocument();
  });

  it("renders navigation links back into the app", () => {
    render(<NotFoundPage />);

    expect(screen.getByRole("link", { name: "Back home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("link", { name: "Go to dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
