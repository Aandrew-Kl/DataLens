import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ErrorBoundary } from "@/components/error/error-boundary";

jest.mock("framer-motion");

function ThrowError({ message = "Something has failed" }: { message?: string }): React.ReactNode {
  throw new Error(message);
}

function HealthyChild() {
  return <p>All good</p>;
}

function ResettableBoundary({ onReset }: { onReset?: () => void }) {
  const [shouldThrow, setShouldThrow] = useState(true);

  return (
    <ErrorBoundary
      onReset={() => {
        onReset?.();
        setShouldThrow(false);
      }}
    >
      {shouldThrow ? <ThrowError /> : <p>Recovered content</p>}
    </ErrorBoundary>
  );
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <HealthyChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("shows fallback UI when a child throws", async () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Something has failed")).toBeInTheDocument();
  });

  it("shows a reset button when rendering the default fallback", async () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(
      await screen.findByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("calls onReset when the reset button is clicked", async () => {
    const user = userEvent.setup();
    const onReset = jest.fn();

    render(<ResettableBoundary onReset={onReset} />);

    await user.click(await screen.findByRole("button", { name: /try again/i }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("re-renders children after reset clears the error", async () => {
    const user = userEvent.setup();

    render(<ResettableBoundary />);

    await user.click(await screen.findByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByText("Recovered content")).toBeInTheDocument();
    });
  });
});
