import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import OnboardingTour from "@/components/ui/onboarding-tour";
import { runQuery } from "@/lib/duckdb/client";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

function renderTargets() {
  return render(
    <div>
      <button data-tour="upload-data" type="button">
        Upload Dataset
      </button>
      <button data-tour="explore-profile" type="button">
        Profile
      </button>
      <button data-tour="ask-ai-questions" type="button">
        Ask AI
      </button>
      <button data-tour="write-sql" type="button">
        SQL Editor
      </button>
      <button data-tour="build-charts" type="button">
        Charts
      </button>
      <OnboardingTour onComplete={jest.fn()} forceShow />
    </div>,
  );
}

describe("OnboardingTour", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("stays hidden when the tour was already completed and forceShow is false", () => {
    window.localStorage.setItem("datalens:onboarding-tour-complete", "true");

    render(<OnboardingTour />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders and lets the user move forward and backward through the steps", async () => {
    renderTargets();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upload Data" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(
      await screen.findByRole("heading", { name: "Explore Profile" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(
      await screen.findByRole("heading", { name: "Upload Data" }),
    ).toBeInTheDocument();
  });

  it("persists completion and calls onComplete when the tour is skipped", async () => {
    const onComplete = jest.fn();

    render(
      <div>
        <button data-tour="upload-data" type="button">
          Upload Dataset
        </button>
        <OnboardingTour onComplete={onComplete} forceShow />
      </div>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /skip tour/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem("datalens:onboarding-tour-complete")).toBe(
      "true",
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard dismissal with Escape", async () => {
    const onComplete = jest.fn();

    render(
      <div>
        <button data-tour="upload-data" type="button">
          Upload Dataset
        </button>
        <OnboardingTour onComplete={onComplete} forceShow />
      </div>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
