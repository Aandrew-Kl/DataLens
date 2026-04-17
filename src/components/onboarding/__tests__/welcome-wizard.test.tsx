import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WelcomeWizard from "@/components/onboarding/welcome-wizard";
import { ToastProvider } from "@/components/ui/toast";

jest.mock("@/components/onboarding/sample-datasets-gallery", () => ({
  __esModule: true,
  default: () => <div data-testid="sample-datasets-gallery">Sample datasets</div>,
}));

jest.mock("@/lib/duckdb/profiler", () => ({
  profileTable: jest.fn().mockResolvedValue([]),
}));

describe("WelcomeWizard", () => {
  const renderWizard = (onClose = jest.fn()) =>
    render(
      <ToastProvider>
        <WelcomeWizard open onClose={onClose} />
      </ToastProvider>,
    );

  beforeEach(() => {
    if (!global.fetch) {
      global.fetch = jest.fn() as typeof fetch;
    }

    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders step 1 by default", () => {
    renderWizard();
    expect(screen.getByText("Welcome to DataLens")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip tour/i })).toBeInTheDocument();
  });

  it("advances to step 2 when clicking next", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() =>
      expect(screen.getByText("Load your first dataset")).toBeInTheDocument(),
    );
  });

  it("goes back to the previous step", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Back/i }));

    await waitFor(() =>
      expect(screen.getByText("Welcome to DataLens")).toBeInTheDocument(),
    );
  });

  it("calls onClose when skipping the tour", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    renderWizard(onClose);

    await user.click(screen.getByRole("button", { name: /Skip tour/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the last step", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    renderWizard(onClose);

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /Done/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = jest.fn();
    renderWizard(onClose);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates with arrow keys", async () => {
    renderWizard();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByText("Load your first dataset")).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByText("Welcome to DataLens")).toBeInTheDocument(),
    );
  });
});
