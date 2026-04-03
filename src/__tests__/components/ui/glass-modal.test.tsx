import { fireEvent, render, screen } from "@testing-library/react";

import GlassModal from "@/components/ui/glass-modal";

jest.mock("framer-motion");

describe("GlassModal", () => {
  it("renders children when open", () => {
    const onClose = jest.fn();

    render(
      <GlassModal open={true} onClose={onClose} title="Example">
        <div data-testid="modal-content">Modal body</div>
      </GlassModal>,
    );

    expect(screen.getByTestId("modal-content")).toBeInTheDocument();
  });

  it("does not render children when closed", () => {
    const onClose = jest.fn();

    render(
      <GlassModal open={false} onClose={onClose} title="Example">
        <div data-testid="modal-content">Modal body</div>
      </GlassModal>,
    );

    expect(screen.queryByTestId("modal-content")).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();

    render(
      <GlassModal open={true} onClose={onClose} title="Example">
        <div>Modal body</div>
      </GlassModal>,
    );

    fireEvent.click(screen.getByRole("button", { name: /close modal/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
