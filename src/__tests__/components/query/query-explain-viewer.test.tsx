import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import QueryExplainViewer from "@/components/query/query-explain-viewer";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "order_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [1, 2],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<QueryExplainViewer tableName="orders" columns={columns} />);
  });
}

describe("QueryExplainViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("runs EXPLAIN and renders plan nodes with costs", async () => {
    mockRunQuery.mockResolvedValue([
      {
        explain_value:
          "PROJECTION cost=10 rows=100\n  HASH_JOIN cost=90 rows=12\n    SEQ_SCAN cost=20 rows=500",
      },
    ]);

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run explain/i }));
    });

    expect(await screen.findByText("PROJECTION cost=10 rows=100")).toBeInTheDocument();
    expect(screen.getByText("HASH_JOIN cost=90 rows=12")).toBeInTheDocument();
    expect(screen.getAllByText("Expensive").length).toBeGreaterThan(0);
  });

  it("stores a baseline and compares a second plan", async () => {
    mockRunQuery
      .mockResolvedValueOnce([
        {
          explain_value:
            "PROJECTION cost=10 rows=100\n  HASH_JOIN cost=90 rows=12",
        },
      ])
      .mockResolvedValueOnce([
        {
          explain_value:
            "PROJECTION cost=15 rows=100\n  FILTER cost=30 rows=10\n  HASH_JOIN cost=120 rows=12",
        },
      ]);

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run explain/i }));
    });

    await screen.findByText("HASH_JOIN cost=90 rows=12");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /use current as baseline/i }));
      fireEvent.change(screen.getByLabelText("SQL query"), {
        target: { value: 'SELECT * FROM "orders" WHERE status = \'active\'' },
      });
      fireEvent.click(screen.getByRole("button", { name: /run explain/i }));
    });

    expect(await screen.findByText(/cost delta:/i)).toBeInTheDocument();
    expect(screen.getByText(/added operators:/i)).toBeInTheDocument();
    expect(screen.getByText("FILTER cost=30 rows=10")).toBeInTheDocument();
  });

  it("updates the expensive operator count after a new explain run", async () => {
    mockRunQuery.mockResolvedValue([
      {
        explain_value:
          "PROJECTION cost=5 rows=100\n  FILTER cost=60 rows=20\n  SEQ_SCAN cost=140 rows=1000",
      },
    ]);

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run explain/i }));
    });

    expect(await screen.findByText("SEQ_SCAN cost=140 rows=1000")).toBeInTheDocument();
    expect(screen.getAllByText("Expensive").length).toBeGreaterThan(0);
  });
});
