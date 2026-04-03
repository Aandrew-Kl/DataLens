import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import QueryScheduler from "@/components/query/query-scheduler";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "customer_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["a1", "b2"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<QueryScheduler tableName="customers" columns={columns} />);
  });
}

function seedSavedQueries() {
  window.localStorage.setItem(
    "datalens-saved-queries",
    JSON.stringify([
      {
        id: "saved-1",
        name: "Active customers",
        sql: 'SELECT * FROM "customers"',
      },
    ]),
  );
}

describe("QueryScheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    seedSavedQueries();
  });

  it("creates a schedule from a saved query", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Schedule name"), {
        target: { value: "Hourly sync" },
      });
      fireEvent.click(screen.getByRole("button", { name: /add schedule/i }));
    });

    expect(await screen.findByText("Hourly sync")).toBeInTheDocument();
    expect(screen.getByText("Added schedule Hourly sync.")).toBeInTheDocument();
  });

  it("toggles a schedule and persists the disabled state", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Schedule name"), {
        target: { value: "Hourly sync" },
      });
      fireEvent.click(screen.getByRole("button", { name: /add schedule/i }));
    });

    await screen.findByText("Hourly sync");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /toggle hourly sync/i }));
    });

    await waitFor(() => {
      const raw = window.localStorage.getItem("datalens-query-schedules") ?? "[]";
      expect(raw).toContain('"enabled":false');
    });
    expect(
      screen.getByRole("button", { name: /toggle hourly sync/i }),
    ).toHaveTextContent("Disabled");
  });

  it("runs a scheduled query immediately and writes history", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS cnt")) {
        return [{ cnt: 3 }];
      }

      return [];
    });

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Schedule name"), {
        target: { value: "Hourly sync" },
      });
      fireEvent.click(screen.getByRole("button", { name: /add schedule/i }));
    });

    await screen.findByText("Hourly sync");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run now/i }));
    });

    expect(
      mockRunQuery.mock.calls.some(([sql]) =>
        sql.includes('CREATE OR REPLACE TABLE "customers_scheduled" AS'),
      ),
    ).toBe(true);
    expect(await screen.findByText("Loaded 3 rows into customers_scheduled.")).toBeInTheDocument();
  });
});
