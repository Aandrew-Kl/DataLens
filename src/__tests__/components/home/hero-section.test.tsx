import { render, screen } from "@testing-library/react";

import HeroSection from "@/components/home/HeroSection";

jest.mock("framer-motion");

const heroProps = {
  title: "DataLens",
  tagline: "Instant insights for every dataset",
  description: "Upload CSV, JSON, or Excel files and start exploring in seconds.",
};

describe("HeroSection", () => {
  it("renders the page title as the primary heading", () => {
    render(<HeroSection {...heroProps} />);

    expect(
      screen.getByRole("heading", { level: 1, name: heroProps.title }),
    ).toBeInTheDocument();
  });

  it("shows the tagline and description copy", () => {
    render(<HeroSection {...heroProps} />);

    expect(screen.getByText(heroProps.tagline)).toBeInTheDocument();
    expect(screen.getByText(heroProps.description)).toBeInTheDocument();
  });

  it("renders the database icon alongside the hero copy", () => {
    const { container } = render(<HeroSection {...heroProps} />);

    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("updates the visible content when props change", () => {
    const { rerender } = render(<HeroSection {...heroProps} />);

    rerender(
      <HeroSection
        title="Explore faster"
        tagline="Smarter profiling"
        description="Bring in messy files and turn them into analysis-ready tables."
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Explore faster" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Smarter profiling")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bring in messy files and turn them into analysis-ready tables.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(heroProps.tagline)).not.toBeInTheDocument();
  });
});
