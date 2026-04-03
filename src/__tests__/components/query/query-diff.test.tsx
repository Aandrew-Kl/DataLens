import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QueryDiff from "@/components/query/query-diff";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["open", "closed"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<QueryDiff tableName="orders" columns={columns} />);
  });
}

describe("QueryDiff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("highlights changed SQL lines and plan lines", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.startsWith("EXPLAIN SELECT * FROM orders LIMIT 50")) {
        return [{ explain_value: "SEQ_SCAN orders\nLIMIT 50" }];
      }
      if (sql.startsWith("EXPLAIN SELECT * FROM orders LIMIT 100")) {
        return [{ explain_value: "SEQ_SCAN orders\nLIMIT 100" }];
      }
      if (sql.includes("LIMIT 50")) {
        return [{ row_count: 50 }];
      }
      return [{ row_count: 100 }];
    });

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compare queries" }));

    expect(await screen.findByText("Execution plan diff")).toBeInTheDocument();
    expect(screen.getAllByText(/LIMIT 50/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/LIMIT 100/i).length).toBeGreaterThan(0);
  });

  it("shows performance comparison metrics for both queries", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.startsWith("EXPLAIN")) {
        return [{ explain_value: "SEQ_SCAN orders" }];
      }
      if (sql.includes("LIMIT 50")) {
        return [{ row_count: 12 }];
      }
      return [{ row_count: 20 }];
    });

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compare queries" }));

    expect(await screen.findByText("Performance comparison")).toBeInTheDocument();
    expect(screen.getByText("12 rows")).toBeInTheDocument();
    expect(screen.getByText("20 rows")).toBeInTheDocument();
  });

  it("surfaces connector errors during comparison", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Explain failed"));

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compare queries" }));

    expect(await screen.findByText("Explain failed")).toBeInTheDocument();
  });
});
