import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DuplicateFinder from "@/components/data/duplicate-finder";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const duplicateColumns: ColumnProfile[] = [
  {
    name: "order_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2],
    min: 1,
    max: 10,
    mean: 5.5,
    median: 5.5,
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["open", "closed"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["east", "west"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["2024-01-01", "2024-01-02"],
    min: "2024-01-01",
    max: "2024-01-10",
  },
];

function getSampleRowValues(): string[] {
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row");

  return rows.slice(1).map((row) => {
    const cells = within(row).getAllByRole("cell");
    return cells[0]?.textContent ?? "";
  });
}

describe("DuplicateFinder", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    jest.restoreAllMocks();
  });

  it("renders an empty state when there are no columns to analyze", () => {
    render(<DuplicateFinder tableName="orders.csv" columns={[]} />);

    expect(
      screen.getByText("No columns available for duplicate analysis."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("analyzes duplicate groups and updates the summary and sample table", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("AS total_rows")) {
        return [
          {
            duplicate_groups: 2,
            total_duplicate_rows: 4,
            total_rows: 10,
          },
        ];
      }

      if (sql.includes("LIMIT 12")) {
        return [
          {
            order_id: 1,
            status: "open",
            region: "east",
            duplicate_count: 3,
          },
          {
            order_id: 2,
            status: "closed",
            region: "west",
            duplicate_count: 1,
          },
        ];
      }

      return [];
    });

    render(<DuplicateFinder tableName="orders.csv" columns={duplicateColumns} />);

    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(
      screen.getByRole("button", { name: /run duplicate query/i }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /select all/i }));
    expect(
      screen.getByRole("button", { name: /run duplicate query/i }),
    ).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /run duplicate query/i }));

    expect(await screen.findByText("40.0%")).toBeInTheDocument();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(getSampleRowValues()).toEqual(["1", "2"]);
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("east")).toBeInTheDocument();
  });

  it("creates a deduplicated table and exposes its generated name for copying", async () => {
    const user = userEvent.setup();

    jest.spyOn(Date, "now").mockReturnValue(123456789);
    mockRunQuery.mockResolvedValue([]);

    render(<DuplicateFinder tableName="orders.csv" columns={duplicateColumns} />);

    await user.click(screen.getByRole("button", { name: /^deduplicate$/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE "orders__dedup_'),
      );
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        'AS SELECT DISTINCT "order_id", "status", "region" FROM "orders.csv"',
      ),
    );
    expect(
      await screen.findByText(/Created orders__dedup_/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy name/i })).toBeInTheDocument();
  });
});
