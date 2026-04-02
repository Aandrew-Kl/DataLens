import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import TransformPanel from "@/components/data/transform-panel";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/components/data/formula-editor", () => ({
  __esModule: true,
  default: ({
    onSave,
  }: {
    onSave: (name: string, expression: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onSave("profit_margin", '"amount" - "discount"')}
    >
      Mock save formula
    </button>
  ),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const mockColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 120,
    sampleValues: [10, 20, 30],
    min: 10,
    max: 300,
    mean: 120,
    median: 100,
  },
  {
    name: "category",
    type: "string",
    nullCount: 5,
    uniqueCount: 4,
    sampleValues: ["A", "B", "C"],
  },
];

function installTransformQueryMocks() {
  mockRunQuery.mockImplementation(async (sql: string) => {
    if (sql === 'DESCRIBE "sales"') {
      return [
        { column_name: "amount", column_type: "INTEGER" },
        { column_name: "category", column_type: "VARCHAR" },
      ];
    }

    if (sql === 'SELECT COUNT(*) AS row_count FROM "sales"') {
      return [{ row_count: 120 }];
    }

    if (sql.includes('CREATE OR REPLACE VIEW "sales_filter_v1"')) {
      return [];
    }

    if (sql === 'DESCRIBE "sales_filter_v1"') {
      return [
        { column_name: "amount", column_type: "INTEGER" },
        { column_name: "category", column_type: "VARCHAR" },
      ];
    }

    if (sql === 'SELECT COUNT(*) AS row_count FROM "sales_filter_v1"') {
      return [{ row_count: 75 }];
    }

    if (sql === 'DROP VIEW IF EXISTS "sales_filter_v1"') {
      return [];
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
}

describe("TransformPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installTransformQueryMocks();
  });

  it("renders the panel and shows the initial validation state", async () => {
    render(
      <TransformPanel
        tableName="sales"
        columns={mockColumns}
        onTransformComplete={jest.fn()}
      />,
    );

    expect(
      await screen.findByText("Build chained DuckDB view transformations"),
    ).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledWith('DESCRIBE "sales"');
    expect(mockRunQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS row_count FROM "sales"',
    );
    expect(
      screen.getByText("No transformations have been materialized yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("Provide a value for the filter.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create view/i }),
    ).toBeDisabled();
  });

  it("creates a filtered view and reports success", async () => {
    const onTransformComplete = jest.fn();

    render(
      <TransformPanel
        tableName="sales"
        columns={mockColumns}
        onTransformComplete={onTransformComplete}
      />,
    );

    const filterValueInput = await screen.findByPlaceholderText("42");
    fireEvent.change(filterValueInput, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /create view/i }));

    await waitFor(() =>
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE OR REPLACE VIEW "sales_filter_v1"'),
      ),
    );

    expect(
      await screen.findByText('Created view "sales_filter_v1" from sales.'),
    ).toBeInTheDocument();
    expect(onTransformComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/sales_filter_v1 from sales/i)).toBeInTheDocument();
    expect(screen.getByText(/1 step/i)).toBeInTheDocument();
  });

  it("undoes the latest transform", async () => {
    const onTransformComplete = jest.fn();

    render(
      <TransformPanel
        tableName="sales"
        columns={mockColumns}
        onTransformComplete={onTransformComplete}
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText("42"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create view/i }));

    await screen.findByText('Created view "sales_filter_v1" from sales.');

    fireEvent.click(screen.getByRole("button", { name: /undo last transform/i }));

    await waitFor(() =>
      expect(mockRunQuery).toHaveBeenCalledWith(
        'DROP VIEW IF EXISTS "sales_filter_v1"',
      ),
    );

    expect(
      await screen.findByText(
        'Undid "Filter rows on amount" and restored "sales".',
      ),
    ).toBeInTheDocument();
    expect(onTransformComplete).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("No transformations have been materialized yet."),
    ).toBeInTheDocument();
  });
});
