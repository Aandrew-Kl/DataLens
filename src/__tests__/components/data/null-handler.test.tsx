import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NullHandler from "@/components/data/null-handler";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const nullableColumns: ColumnProfile[] = [
  {
    name: "age",
    type: "number",
    nullCount: 2,
    uniqueCount: 6,
    sampleValues: [29, 31, 35],
    min: 29,
    max: 35,
    mean: 31.5,
    median: 31,
  },
  {
    name: "city",
    type: "string",
    nullCount: 1,
    uniqueCount: 3,
    sampleValues: ["Athens", "Berlin"],
  },
  {
    name: "is_active",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

describe("NullHandler", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    jest.restoreAllMocks();
  });

  it("renders a no-null state and lets the user continue immediately", async () => {
    const user = userEvent.setup();
    const onComplete = jest.fn();

    render(
      <NullHandler
        tableName="customers"
        columns={nullableColumns.map((column) => ({ ...column, nullCount: 0 }))}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("No null values detected")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS cnt FROM "customers"',
      );
    });

    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("loads preview data and applies the null-handling plan with a table swap", async () => {
    const user = userEvent.setup();
    const onComplete = jest.fn();

    jest.spyOn(Date, "now").mockReturnValue(777);
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql === 'SELECT COUNT(*) AS cnt FROM "customers"') {
        return [{ cnt: 10 }];
      }

      if (sql.includes("SELECT COUNT(*) AS row_count")) {
        return [{ row_count: 9, n0: 0, n1: 0 }];
      }

      if (sql.includes("LIMIT 6")) {
        return [
          { age: 31.5, city: "Athens", is_active: true },
          { age: 35, city: "Berlin", is_active: false },
        ];
      }

      return [];
    });

    render(
      <NullHandler
        tableName="customers"
        columns={nullableColumns}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS cnt FROM "customers"',
      );
    });

    expect(
      screen.getByRole("button", { name: /apply changes/i }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /preview result/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining("SELECT COUNT(*) AS row_count"),
      );
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT 6"),
      );
      expect(document.body).toHaveTextContent("Athens");
      expect(document.body).toHaveTextContent("Ready");
      expect(
        screen.getByRole("button", { name: /apply changes/i }),
      ).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /apply changes/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE "customers__nulls_777" AS'),
      );
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "customers__nulls_777"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "customers__backup_777"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "customers" RENAME TO "customers__backup_777"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "customers__nulls_777" RENAME TO "customers"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith('DROP TABLE "customers__backup_777"');
    expect(
      await screen.findByText("Applied null handling to customers."),
    ).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("requires a custom value before previewing a custom fill plan", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql === 'SELECT COUNT(*) AS cnt FROM "customers"') {
        return [{ cnt: 10 }];
      }

      return [];
    });

    render(
      <NullHandler
        tableName="customers"
        columns={nullableColumns}
        onComplete={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS cnt FROM "customers"',
      );
    });

    const [ageActionSelect] = screen.getAllByRole("combobox");
    fireEvent.change(ageActionSelect, {
      target: { value: "custom" },
    });

    expect(screen.getByPlaceholderText("Custom number value")).toBeInTheDocument();
    expect(
      screen.getByText("Enter a value before previewing or applying."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview result/i })).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Custom number value"), "42");

    expect(screen.getByRole("button", { name: /preview result/i })).toBeEnabled();
  });
});
