import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataAlerts from "@/components/data/data-alerts";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["ok", "late"],
  },
];

describe("DataAlerts", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    window.localStorage.clear();
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("matched_count")) {
        return [{ matched_count: 3 }];
      }
      return [];
    });
  });

  it("creates a threshold rule and raises an active alert", async () => {
    const user = userEvent.setup();

    render(<DataAlerts tableName="orders" columns={columns} rowCount={100} />);

    fireEvent.change(screen.getByPlaceholderText("Threshold value"), {
      target: { value: "100" },
    });

    await user.click(screen.getByRole("button", { name: "Add rule" }));

    await waitFor(() => {
      expect(screen.getAllByText("revenue crossed its threshold")).toHaveLength(2);
      expect(screen.getAllByText("3 rows matched revenue > 100.")).toHaveLength(2);
    });

    const storedRules = JSON.parse(
      window.localStorage.getItem("datalens:alert-rules:orders") ?? "[]",
    ) as Array<{ column: string; value: string }>;

    expect(storedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "revenue",
          value: "100",
        }),
      ]),
    );
  });

  it("snoozes an active alert", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:alert-events:orders",
      JSON.stringify([
        {
          id: "event-1",
          ruleId: "rule-1",
          title: "revenue crossed its threshold",
          detail: "3 rows matched revenue > 100.",
          severity: "warning",
          status: "active",
          signature: "threshold:3",
          triggeredAt: 1,
        },
      ]),
    );

    render(<DataAlerts tableName="orders" columns={columns} rowCount={100} />);

    await user.click(screen.getByRole("button", { name: "Snooze 1h" }));

    await waitFor(() => {
      expect(screen.getByText("No active alerts right now.")).toBeInTheDocument();
      expect(screen.getByText("snoozed")).toBeInTheDocument();
    });
  });

  it("dismisses an active alert", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:alert-events:orders",
      JSON.stringify([
        {
          id: "event-1",
          ruleId: "rule-1",
          title: "revenue crossed its threshold",
          detail: "3 rows matched revenue > 100.",
          severity: "critical",
          status: "active",
          signature: "threshold:3",
          triggeredAt: 1,
        },
      ]),
    );

    render(<DataAlerts tableName="orders" columns={columns} rowCount={100} />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.getByText("No active alerts right now.")).toBeInTheDocument();
      expect(screen.getByText("dismissed")).toBeInTheDocument();
    });
  });

  it("deletes a saved rule", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:alert-rules:orders",
      JSON.stringify([
        {
          id: "rule-1",
          type: "threshold",
          column: "revenue",
          condition: ">",
          value: "100",
          severity: "warning",
          baselineOutlierCount: 0,
        },
      ]),
    );

    render(<DataAlerts tableName="orders" columns={columns} rowCount={100} />);

    await waitFor(() => {
      expect(screen.getByText("revenue > 100")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText("No alert rules configured yet.")).toBeInTheDocument();
    });
  });

  it("shows evaluation failures", async () => {
    window.localStorage.setItem(
      "datalens:alert-rules:orders",
      JSON.stringify([
        {
          id: "rule-1",
          type: "threshold",
          column: "revenue",
          condition: ">",
          value: "100",
          severity: "warning",
          baselineOutlierCount: 0,
        },
      ]),
    );
    mockRunQuery.mockRejectedValueOnce(new Error("Alert evaluation failed"));

    render(<DataAlerts tableName="orders" columns={columns} rowCount={100} />);

    await waitFor(() => {
      expect(screen.getByText("Alert evaluation failed")).toBeInTheDocument();
    });
  });
});
