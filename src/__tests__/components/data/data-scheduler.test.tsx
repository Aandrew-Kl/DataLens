import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataScheduler from "@/components/data/data-scheduler";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["open", "closed"],
  },
];

describe("DataScheduler", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([{ row_count: 24 }]);
  });

  it("renders the scheduler with empty task states", () => {
    const user = userEvent.setup();

    render(<DataScheduler tableName="orders" columns={columns} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "In-browser automation for orders",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No scheduled tasks yet. Configure one above to start periodic runs."),
    ).toBeInTheDocument();

    void user;
  });

  it("surfaces unsupported browser notifications", async () => {
    const user = userEvent.setup();
    const originalNotification = window.Notification;
    Reflect.deleteProperty(window, "Notification");

    render(<DataScheduler tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() => {
      expect(
        screen.getByText("Browser notifications are not supported in this environment."),
      ).toBeInTheDocument();
    });

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
  });

  it("creates a task and adds it to the upcoming timeline", async () => {
    const user = userEvent.setup();

    render(<DataScheduler tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("Task name"), {
      target: { value: "Morning refresh" },
    });
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(screen.getByText("Scheduled Morning refresh.")).toBeInTheDocument();
    expect(screen.getAllByText("Morning refresh")).toHaveLength(2);
    expect(screen.getByText("Daily at 09:00")).toBeInTheDocument();
  });

  it("runs a task manually and records the history entry", async () => {
    const user = userEvent.setup();

    render(<DataScheduler tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("Task name"), {
      target: { value: "Manual refresh" },
    });
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await user.click(screen.getByRole("button", { name: "Run now" }));

    await waitFor(() => {
      expect(
        screen.getByText("Manual run completed for Manual refresh."),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("24 rows processed.")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("toggles a scheduled task off", async () => {
    const user = userEvent.setup();

    render(<DataScheduler tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Create task" }));
    await user.click(screen.getByRole("button", { name: "Enabled" }));

    expect(screen.getByRole("button", { name: "Disabled" })).toBeInTheDocument();
  });
});
