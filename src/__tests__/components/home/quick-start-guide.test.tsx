import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Database, Zap } from "lucide-react";

import QuickStartGuide from "@/components/home/QuickStartGuide";
import type { HomeFeatureBadge } from "@/components/home/types";

jest.mock("framer-motion");
jest.mock("@/components/ui/error-boundary", () => ({
  __esModule: true,
  ErrorBoundary: ({ children }: { children: ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
}));
jest.mock("@/components/data/sample-datasets", () => ({
  __esModule: true,
  default: ({
    onLoad,
  }: {
    onLoad: (fileName: string, csvContent: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onLoad("sample.csv", "region,revenue\nEast,100")}
    >
      Mock sample datasets
    </button>
  ),
}));

const features: HomeFeatureBadge[] = [
  {
    icon: Database,
    label: "Local DuckDB",
    description: "Run analytics in the browser without shipping data away.",
  },
  {
    icon: Zap,
    label: "Fast profiling",
    description: "Understand shape and quality before building queries.",
  },
];

describe("QuickStartGuide", () => {
  it("renders the sample dataset prompt and chooser", () => {
    render(
      <QuickStartGuide
        features={features}
        onSampleLoad={jest.fn()}
      />,
    );

    expect(screen.getByText("Or try a sample dataset:")).toBeInTheDocument();
    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mock sample datasets" }),
    ).toBeInTheDocument();
  });

  it("forwards sample loading through the onSampleLoad prop", () => {
    const onSampleLoad = jest.fn();

    render(
      <QuickStartGuide
        features={features}
        onSampleLoad={onSampleLoad}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mock sample datasets" }),
    );

    expect(onSampleLoad).toHaveBeenCalledWith(
      "sample.csv",
      "region,revenue\nEast,100",
    );
  });

  it("renders each quick-start feature badge", () => {
    const { container } = render(
      <QuickStartGuide
        features={features}
        onSampleLoad={jest.fn()}
      />,
    );

    expect(screen.getByText("Local DuckDB")).toBeInTheDocument();
    expect(screen.getByText("Fast profiling")).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(features.length);
  });

  it("keeps the feature labels in the provided order", () => {
    render(
      <QuickStartGuide
        features={features}
        onSampleLoad={jest.fn()}
      />,
    );

    expect(
      features.map((feature) => screen.getByText(feature.label).textContent),
    ).toEqual(features.map((feature) => feature.label));
  });
});
