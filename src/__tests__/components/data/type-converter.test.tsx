import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TypeConverter from "@/components/data/type-converter";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "raw_amount",
    type: "unknown",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["100", "oops", "50"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["2025-01-01"],
  },
];

describe("TypeConverter", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockRunQuery.mockReset();
  });

  it("previews a conversion and applies it successfully", async () => {
    const user = userEvent.setup();
    const onConvert = jest.fn();

    jest.spyOn(Date, "now").mockReturnValue(123);
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("invalid_count")) {
        return [{ invalid_count: 2, non_null_count: 3 }];
      }

      if (sql.includes("WITH preview")) {
        return [
          { original_value: "oops", converted_value: null, invalid_cast: true },
          { original_value: "100", converted_value: "100", invalid_cast: false },
        ];
      }

      if (sql === 'DROP TABLE IF EXISTS "orders__typecast_123"') {
        return [];
      }

      if (sql === 'DROP TABLE IF EXISTS "orders__backup_123"') {
        return [];
      }

      if (sql.startsWith('CREATE TABLE "orders__typecast_123" AS SELECT ')) {
        return [];
      }

      if (sql === 'ALTER TABLE "orders" RENAME TO "orders__backup_123"') {
        return [];
      }

      if (sql === 'ALTER TABLE "orders__typecast_123" RENAME TO "orders"') {
        return [];
      }

      if (sql === 'DROP TABLE "orders__backup_123"') {
        return [];
      }

      return [];
    });

    render(
      <TypeConverter tableName="orders" columns={columns} onConvert={onConvert} />,
    );

    const [rawAmountSelect] = screen.getAllByRole("combobox");

    await waitFor(() => {
      expect(rawAmountSelect).toHaveValue("string");
    });

    fireEvent.change(rawAmountSelect, {
      target: { value: "number" },
    });

    await waitFor(() => {
      expect(rawAmountSelect).toHaveValue("number");
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining("invalid_count"),
      );
      expect(screen.getByRole("button", { name: /^Apply/i })).toHaveTextContent(
        "Apply (1)",
      );
      expect(screen.getByRole("button", { name: /^Apply/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /^Apply/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE "orders__typecast_123" AS SELECT'),
      );
      expect(onConvert).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText(/Converted 1 column in orders\./i),
    ).toBeInTheDocument();
  });

  it("shows preview errors from DuckDB", async () => {
    mockRunQuery.mockRejectedValue(new Error("Conversion preview failed"));

    render(
      <TypeConverter
        tableName="orders"
        columns={columns}
        onConvert={jest.fn()}
      />,
    );

    expect(
      await screen.findByText("Conversion preview failed"),
    ).toBeInTheDocument();
  });
});
