import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FormulaEditor from "@/components/data/formula-editor";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [100, 120, 140],
  },
  {
    name: "cost",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [60, 70, 80],
  },
];

describe("FormulaEditor", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("inserts a column, previews the expression, and saves the formula", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();

    mockRunQuery
      .mockResolvedValueOnce([
        { rounded_revenue: 120.25 },
        { rounded_revenue: 80.5 },
      ])
      .mockResolvedValueOnce([{ rounded_revenue: 120.25 }]);

    render(
      <FormulaEditor tableName="orders" columns={columns} onSave={onSave} />,
    );

    await user.click(screen.getByRole("button", { name: /revenue number/i }));
    const textarea = screen.getByPlaceholderText(
      'COALESCE("revenue", 0) - COALESCE("cost", 0)',
    ) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toContain('"revenue"');
    });

    fireEvent.change(screen.getByPlaceholderText("profit_margin"), {
      target: { value: "rounded_revenue" },
    });

    await user.click(screen.getByRole("button", { name: /^Preview$/i }));
    expect(
      await screen.findByText("Preview returned 2 sample rows."),
    ).toBeInTheDocument();
    expect(screen.getByText("120.25")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledWith(
      'SELECT "revenue" AS "rounded_revenue" FROM "orders" LIMIT 5',
    );

    await user.click(screen.getByRole("button", { name: /Save formula/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        "rounded_revenue",
        '"revenue"',
      );
    });
    expect(
      screen.getByText('Saved computed column "rounded_revenue".'),
    ).toBeInTheDocument();
  });

  it("shows validation errors before executing DuckDB queries", async () => {
    const user = userEvent.setup();

    render(
      <FormulaEditor tableName="orders" columns={columns} onSave={jest.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /Save formula/i }));
    expect(
      screen.getByText("Computed columns need a name before they can be saved."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("profit_margin"), {
      target: { value: "revenue" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        'COALESCE("revenue", 0) - COALESCE("cost", 0)',
      ),
      {
        target: { value: "1" },
      },
    );

    await user.click(screen.getByRole("button", { name: /Save formula/i }));

    expect(document.body).toHaveTextContent(
      'A column named "revenue" already exists in orders.',
    );
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
