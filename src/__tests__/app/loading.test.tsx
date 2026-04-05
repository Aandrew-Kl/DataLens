import { render, screen } from "@testing-library/react";

import LoadingPage from "@/app/loading";

describe("LoadingPage", () => {
  it("renders the requested loading text", () => {
    render(<LoadingPage />);

    expect(screen.getByText("Loading DataLens...")).toBeInTheDocument();
  });

  it("renders the loading status region with an animated spinner", () => {
    render(<LoadingPage />);

    const statusRegion = screen.getByRole("status");
    const spinner = statusRegion.querySelector(".animate-spin");

    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(spinner).not.toBeNull();
  });
});
