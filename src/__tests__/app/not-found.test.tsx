import { render, screen } from "@testing-library/react";

import NotFoundPage from "@/app/not-found";

jest.mock("@/components/layout/not-found", () => ({
  __esModule: true,
  default: () => <div data-testid="not-found-page">Not Found</div>,
}));

describe("NotFoundPage", () => {
  it("renders the NotFound page", () => {
    render(<NotFoundPage />);

    expect(screen.getByTestId("not-found-page")).toBeInTheDocument();
  });
});
