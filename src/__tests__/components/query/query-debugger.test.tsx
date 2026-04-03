import { render, screen } from "@testing-library/react";
import { act } from "react";

import QueryDebugger from "@/components/query/query-debugger";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const columns: ColumnProfile[] = [
  { name: "id", type: "number", nullable: false, unique: 100 },
  { name: "name", type: "string", nullable: false, unique: 80 },
] as ColumnProfile[];

describe("QueryDebugger", () => {
  it("renders the debugger heading and run button", async () => {
    await act(async () => {
      render(<QueryDebugger tableName="orders" columns={columns} />);
    });

    expect(screen.getByText("Query Debugger")).toBeInTheDocument();
    expect(screen.getByText("Run EXPLAIN ANALYZE")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Inspect EXPLAIN ANALYZE output and slow operators",
      ),
    ).toBeInTheDocument();
  });

  it("renders summary stat cards with default values", async () => {
    await act(async () => {
      render(<QueryDebugger tableName="orders" columns={columns} />);
    });

    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText("Plan nodes")).toBeInTheDocument();
    expect(screen.getByText("Slowest step")).toBeInTheDocument();
    // Default values before running
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows empty state messages before running debugger", async () => {
    await act(async () => {
      render(<QueryDebugger tableName="orders" columns={columns} />);
    });

    expect(
      screen.getByText("Run the debugger to inspect the plan tree."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Timing rows will appear here after the first debug run.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The debugger will rank the slowest operators once a plan is available.",
      ),
    ).toBeInTheDocument();
  });

  it("has a textarea for SQL input with default query", async () => {
    await act(async () => {
      render(<QueryDebugger tableName="orders" columns={columns} />);
    });

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue(
      'SELECT *\nFROM "orders"\nLIMIT 100;',
    );
  });
});
