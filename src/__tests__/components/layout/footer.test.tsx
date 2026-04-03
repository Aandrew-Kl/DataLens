import { render, screen } from "@testing-library/react";

import Footer from "@/components/layout/footer";

describe("Footer", () => {
  it("renders the product branding and AI badge", () => {
    render(<Footer />);

    expect(screen.getByText("DataLens")).toBeInTheDocument();
    expect(screen.getByText("Built with AI")).toBeInTheDocument();
    expect(screen.getByText("MIT License")).toBeInTheDocument();
  });

  it("renders the expected tech stack chips", () => {
    render(<Footer />);

    expect(screen.getByText("Next.js 16")).toBeInTheDocument();
    expect(screen.getByText("DuckDB-WASM")).toBeInTheDocument();
    expect(screen.getByText("Ollama")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("links to the GitHub repository in a new tab", () => {
    render(<Footer />);

    const link = screen.getByRole("link", { name: "GitHub" });

    expect(link).toHaveAttribute("href", "https://github.com/Aandrew-Kl/DataLens");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
