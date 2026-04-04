import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ErrorBoundary } from "@/components/ui/error-boundary";

jest.mock("framer-motion");

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Something has failed");
  }

  return <p>Recovered content</p>;
}

function HealthyChild() {
  return <p>All good</p>;
}

function ResettableBoundary() {
  const [shouldThrow, setShouldThrow] = useState(true);

  return (
    <ErrorBoundary onReset={() => setShouldThrow(false)}>
      <ThrowingChild shouldThrow={shouldThrow} />
    </ErrorBoundary>
  );
}

describe("ErrorBoundary", () => {
  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <HealthyChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("renders fallback UI when an error is thrown", async () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText("Something has failed")).toBeInTheDocument();
    });
  });

  it("reset button recovers the boundary and re-renders children", async () => {
    const user = userEvent.setup();

    render(<ResettableBoundary />);

    expect(screen.getByText("Something has failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByText("Recovered content")).toBeInTheDocument();
    });
  });
});
