import { render } from "@testing-library/react";

import LoadingSkeleton from "@/components/ui/loading-skeleton";

jest.mock("framer-motion");

describe("LoadingSkeleton", () => {
  it("renders the requested number of skeleton lines", () => {
    const { container } = render(<LoadingSkeleton lines={4} />);

    const lines = container.querySelectorAll("[class*='animate-pulse']");

    expect(lines).toHaveLength(4);
  });

  it("applies custom className to the wrapper", () => {
    const { container } = render(
      <LoadingSkeleton lines={2} className="custom-loading-skeleton" />,
    );

    expect(container.firstElementChild).toHaveClass("custom-loading-skeleton");
  });
});
