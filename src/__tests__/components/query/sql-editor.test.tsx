import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import SQLEditor from "@/components/query/sql-editor";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const mockColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [10, 20],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
];

describe("SQLEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders and executes a query with the keyboard shortcut", async () => {
    const onQueryResult = jest.fn();

    mockRunQuery.mockResolvedValue([{ amount: 42, region: "East" }]);

    render(
      <SQLEditor
        tableName="sales"
        columns={mockColumns}
        onQueryResult={onQueryResult}
        defaultSQL='SELECT amount, region FROM "sales";'
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Write your SQL query here...",
    ) as HTMLTextAreaElement;

    expect(textarea.value).toBe('SELECT amount, region FROM "sales";');

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() =>
      expect(mockRunQuery).toHaveBeenCalledWith(
        'SELECT amount, region FROM "sales";',
      ),
    );

    expect(onQueryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: 'SELECT amount, region FROM "sales";',
        columns: ["amount", "region"],
        data: [{ amount: 42, region: "East" }],
      }),
    );
    expect(await screen.findByText(/1 row/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(
      screen.getAllByText('SELECT amount, region FROM "sales";').length,
    ).toBeGreaterThan(1);
  });

  it("formats, copies, and clears SQL", async () => {
    render(
      <SQLEditor
        tableName="sales"
        columns={mockColumns}
        defaultSQL={'select * from "sales" where amount > 10'}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      "Write your SQL query here...",
    ) as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: /format/i }));
    expect(textarea.value).toBe('SELECT *\nFROM "sales"\nWHERE amount > 10');

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'SELECT *\nFROM "sales"\nWHERE amount > 10',
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /copied/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(textarea.value).toBe("");
    expect(screen.getByRole("button", { name: /run/i })).toBeDisabled();
  });

  it("toggles the schema panel and inserts a column reference", async () => {
    render(
      <SQLEditor tableName="sales" columns={mockColumns} defaultSQL="" />,
    );

    const textarea = screen.getByPlaceholderText(
      "Write your SQL query here...",
    ) as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: /schema/i }));
    expect(screen.getByText("sales")).toBeInTheDocument();

    textarea.focus();
    textarea.setSelectionRange(0, 0);
    fireEvent.click(screen.getByTitle('Insert "amount"'));

    expect(textarea.value).toBe('"amount"');
  });
});
