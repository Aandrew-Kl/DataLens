import { render, screen } from "@testing-library/react";

import DataLensAppShell from "@/components/layout/app-shell";

jest.mock("@/app/page", () => ({
  __esModule: true,
  default: () => <div data-testid="page">Page</div>,
}));

jest.mock("framer-motion");

describe("DataLensAppShell", () => {
  it("renders without crashing", () => {
    render(<DataLensAppShell />);

    expect(screen.getByTestId("page")).toBeInTheDocument();
  });
});
