import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColumnRenamer from "@/components/data/column-renamer";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const snakeCaseColumns: ColumnProfile[] = [
  {
    name: "First Name",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Ada", "Grace"],
  },
  {
    name: "Order Total",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [120, 240],
    min: 120,
    max: 240,
    mean: 180,
    median: 180,
  },
];

const ctasColumns: ColumnProfile[] = [
  {
    name: "OrderID",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2],
    min: 1,
    max: 4,
    mean: 2.5,
    median: 2.5,
  },
  {
    name: "Customer Name",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Ada", "Grace"],
  },
];

describe("ColumnRenamer", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    jest.restoreAllMocks();
  });

  it("renders the rename plan, applies a preset, and renames columns with ALTER TABLE", async () => {
    const user = userEvent.setup();
    const onComplete = jest.fn();

    mockRunQuery.mockResolvedValue([]);

    render(
      <ColumnRenamer
        tableName="sales"
        columns={snakeCaseColumns}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Batch Column Renamer")).toBeInTheDocument();
    expect(screen.getByText("2 columns")).toBeInTheDocument();
    expect(
      screen.getByText("Edit one or more target names to build the batch preview."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /snake_case/i }));

    expect(screen.getByDisplayValue("first_name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("order_total")).toBeInTheDocument();
    expect(screen.getByText("2 pending changes")).toBeInTheDocument();
    expect(screen.getByText("first_name")).toBeInTheDocument();
    expect(screen.getByText("order_total")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /apply \(2\)/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(2);
    });

    expect(mockRunQuery).toHaveBeenNthCalledWith(
      1,
      'ALTER TABLE "sales" RENAME COLUMN "First Name" TO "first_name"',
    );
    expect(mockRunQuery).toHaveBeenNthCalledWith(
      2,
      'ALTER TABLE "sales" RENAME COLUMN "Order Total" TO "order_total"',
    );
    expect(
      await screen.findByText("Renamed 2 columns in sales."),
    ).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("blocks invalid duplicate target names", async () => {
    render(
      <ColumnRenamer
        tableName="sales"
        columns={snakeCaseColumns}
        onComplete={jest.fn()}
      />,
    );

    const secondInput = screen.getByDisplayValue("Order Total");

    fireEvent.change(secondInput, {
      target: { value: "First Name" },
    });

    expect(document.body).toHaveTextContent(
      '"First Name" would duplicate "First Name".',
    );
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("falls back to the CTAS swap strategy for case-only style renames", async () => {
    const user = userEvent.setup();
    const onComplete = jest.fn();

    mockRunQuery.mockResolvedValue([]);
    jest.spyOn(Date, "now").mockReturnValue(321);

    render(
      <ColumnRenamer
        tableName="sales"
        columns={ctasColumns}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: /camelCase/i }));

    expect(screen.getByText("CTAS swap")).toBeInTheDocument();
    expect(screen.getByDisplayValue("orderId")).toBeInTheDocument();
    expect(screen.getByDisplayValue("customerName")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /apply \(2\)/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'CREATE TABLE "sales__renamed_321" AS SELECT "OrderID" AS "orderId", "Customer Name" AS "customerName" FROM "sales"',
      );
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "sales__renamed_321"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "sales__rename_backup_321"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "sales" RENAME TO "sales__rename_backup_321"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "sales__renamed_321" RENAME TO "sales"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'DROP TABLE "sales__rename_backup_321"',
    );
    expect(
      await screen.findByText("Renamed 2 columns in sales."),
    ).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
