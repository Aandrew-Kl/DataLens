import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QueryDebugger from "@/components/query/query-debugger";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [1, 2],
  },
  {
    name: "name",
    type: "string",
    nullCount: 0,
    uniqueCount: 80,
    sampleValues: ["Ada", "Grace"],
  },
];

describe("QueryDebugger", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders the default SQL and disables the run button for whitespace-only input", async () => {
    render(<QueryDebugger tableName="orders" columns={columns} />);

    const textarea = screen.getByRole("textbox");
    const runButton = screen.getByRole("button", { name: /run explain analyze/i });

    expect(textarea).toHaveValue('SELECT *\nFROM "orders"\nLIMIT 100;');
    expect(runButton).toBeEnabled();

    fireEvent.change(textarea, { target: { value: "   " } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /run explain analyze/i }),
      ).toBeDisabled();
    });
  });

  it("parses EXPLAIN output and renders the plan tree, timings, and raw output", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      {
        explain_key: "plan",
        explain_value: "SEQ_SCAN 8 ms\nrows=100",
      },
      {
        explain_key: "plan",
        explain_value: "FILTER 4 ms\nrows=50\nTotal Time: 12 ms",
      },
    ]);

    render(<QueryDebugger tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /run explain analyze/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'EXPLAIN ANALYZE SELECT *\nFROM "orders"\nLIMIT 100;',
      );
    });

    expect(await screen.findByText("Raw EXPLAIN ANALYZE output")).toBeInTheDocument();
    expect(screen.getByText("Execution plan tree")).toBeInTheDocument();
    expect(screen.getByText("Timing breakdown")).toBeInTheDocument();
    expect(screen.getByText("Slow operations")).toBeInTheDocument();

    expect(screen.getAllByText("SEQ_SCAN 8 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FILTER 4 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rows=100/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rows=50/).length).toBeGreaterThan(0);

    expect(screen.getByText("12ms")).toBeInTheDocument();
    expect(screen.getAllByText("8ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Total Time: 12 ms/).length).toBeGreaterThan(0);
  });

  it("shows the DuckDB error message when EXPLAIN ANALYZE fails", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error('Parser Error: syntax error at or near "FROM"'));

    render(<QueryDebugger tableName="orders" columns={columns} />);

    const textarea = screen.getByRole("textbox");

    fireEvent.change(textarea, { target: { value: "SELECT FROM orders;" } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /run explain analyze/i }),
      ).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /run explain analyze/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith("EXPLAIN ANALYZE SELECT FROM orders;");
    });
    await waitFor(() => {
      expect(
        screen.getByText(/Parser Error: syntax error at or near "FROM"/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Raw EXPLAIN ANALYZE output")).not.toBeInTheDocument();
  });
});
