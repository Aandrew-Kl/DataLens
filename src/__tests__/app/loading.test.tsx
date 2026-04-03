import { render, screen } from "@testing-library/react";

import LoadingPage from "@/app/loading";

describe("LoadingPage", () => {
  it("renders the loading text", () => {
    render(<LoadingPage />);

    expect(screen.getByText("Loading DataLens...")).toBeInTheDocument();
  });

  it("renders the pulse animation div", () => {
    render(<LoadingPage />);

    const loadingText = screen.getByText("Loading DataLens...");
    const pulseContainer = loadingText.closest("div");

    expect(pulseContainer).not.toBeNull();
    expect(pulseContainer).toHaveClass("animate-pulse");
  });
});
