import { render, screen } from "@testing-library/react";

import { ErrorBoundary } from "@/components/ui/error-boundary";

function ThrowingComponent(): React.ReactNode {
  throw new Error("Something has failed");
}

function HealthyComponent() {
  return <p>All good</p>;
}

function HealthWithFallbackBoundary() {
  return (
    <ErrorBoundary fallback={<p>Fallback UI</p>}>
      <ThrowingComponent />
    </ErrorBoundary>
  );
}

function DefaultBoundary() {
  return (
    <ErrorBoundary>
      <ThrowingComponent />
    </ErrorBoundary>
  );
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <HealthyComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("renders fallback when child throws", () => {
    render(<HealthWithFallbackBoundary />);

    expect(screen.getByText("Fallback UI")).toBeInTheDocument();
  });

  it("shows the Try again button in error state", () => {
    render(<DefaultBoundary />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Something has failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
