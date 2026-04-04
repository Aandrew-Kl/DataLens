import { render, screen } from "@testing-library/react";

import LoadingPage from "@/app/loading";

describe("LoadingPage", () => {
  it("renders the loading text without a trailing ellipsis", () => {
    render(<LoadingPage />);

    expect(screen.getByText("Loading DataLens")).toBeInTheDocument();
  });

  it("renders the loading status region with animated indicators", () => {
    render(<LoadingPage />);

    const statusRegion = screen.getByRole("status");
    const spinner = statusRegion.querySelector(".animate-spin");
    const pulseIndicators = statusRegion.querySelectorAll(".animate-pulse");

    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(spinner).not.toBeNull();
    expect(pulseIndicators.length).toBeGreaterThan(0);
  });
});
