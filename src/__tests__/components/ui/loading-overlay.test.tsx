import { render, screen } from "@testing-library/react";

import LoadingOverlay from "@/components/ui/loading-overlay";

describe("LoadingOverlay", () => {
  it("does not render when not visible", () => {
    render(<LoadingOverlay visible={false} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the message and progress when visible", () => {
    render(
      <LoadingOverlay
        visible
        message="Profiling dataset"
        progress={42}
      />,
    );

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Profiling dataset")).toBeInTheDocument();
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("clamps progress values into the safe range", () => {
    const { rerender } = render(
      <LoadingOverlay visible message="Uploading" progress={150} />,
    );

    expect(screen.getByText("100%")).toBeInTheDocument();

    rerender(<LoadingOverlay visible message="Uploading" progress={-12} />);

    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("restores body scrolling when the overlay hides", () => {
    const { rerender } = render(<LoadingOverlay visible message="Syncing" />);

    expect(document.body.style.overflow).toBe("hidden");

    rerender(<LoadingOverlay visible={false} message="Syncing" />);

    expect(document.body.style.overflow).toBe("");
  });
});
