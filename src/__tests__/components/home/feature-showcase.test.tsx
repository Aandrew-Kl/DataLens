import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Database, Search } from "lucide-react";

import FeatureShowcase from "@/components/home/FeatureShowcase";
import type { HomeFeatureCard } from "@/components/home/types";

jest.mock("framer-motion");
jest.mock("@/components/ui/error-boundary", () => ({
  __esModule: true,
  ErrorBoundary: ({ children }: { children: ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
}));
jest.mock("@/components/data/data-faker", () => ({
  __esModule: true,
  default: ({
    onDataGenerated,
  }: {
    onDataGenerated: (csvContent: string, fileName: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onDataGenerated("region,revenue\nEast,100", "generated.csv")}
    >
      Mock data faker
    </button>
  ),
}));

const features: HomeFeatureCard[] = [
  {
    icon: Database,
    title: "Profile uploads",
    description: "Inspect schema, null counts, and sample values immediately.",
  },
  {
    icon: Search,
    title: "Ask natural questions",
    description: "Generate SQL and charts directly from plain English prompts.",
  },
];

describe("FeatureShowcase", () => {
  it("renders the embedded data faker inside the error boundary", () => {
    render(
      <FeatureShowcase
        features={features}
        onDataGenerated={jest.fn()}
      />,
    );

    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mock data faker" }),
    ).toBeInTheDocument();
  });

  it("forwards generated data from DataFaker", () => {
    const onDataGenerated = jest.fn();

    render(
      <FeatureShowcase
        features={features}
        onDataGenerated={onDataGenerated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mock data faker" }));

    expect(onDataGenerated).toHaveBeenCalledWith(
      "region,revenue\nEast,100",
      "generated.csv",
    );
  });

  it("renders each feature card title and description", () => {
    const { container } = render(
      <FeatureShowcase
        features={features}
        onDataGenerated={jest.fn()}
      />,
    );

    expect(screen.getByText("Profile uploads")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Inspect schema, null counts, and sample values immediately.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Ask natural questions")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Generate SQL and charts directly from plain English prompts.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(features.length);
  });

  it("keeps the feature cards in the provided order", () => {
    render(
      <FeatureShowcase
        features={features}
        onDataGenerated={jest.fn()}
      />,
    );

    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(features.map((feature) => feature.title));
  });
});
