import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ErrorBoundary, ErrorFallback } from "@/components/ui/error-boundary";

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Boom failure");
  }

  return <div>Healthy content</div>;
}

function ResetHarness() {
  const [shouldThrow, setShouldThrow] = React.useState(true);

  return (
    <ErrorBoundary onReset={() => setShouldThrow(false)}>
      <ProblemChild shouldThrow={shouldThrow} />
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
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Healthy content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("renders the default fallback and resets when try again is clicked", async () => {
    render(<ResetHarness />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Boom failure")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    await waitFor(() => {
      expect(screen.getByText("Healthy content")).toBeInTheDocument();
    });
  });

  it("renders a custom fallback when one is provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("renders the functional error fallback and calls reset", () => {
    const resetErrorBoundary = jest.fn();

    render(
      <ErrorFallback
        error={new Error("Recovered error")}
        resetErrorBoundary={resetErrorBoundary}
      />,
    );

    expect(screen.getByText("Recovered error")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(resetErrorBoundary).toHaveBeenCalledTimes(1);
  });
});
