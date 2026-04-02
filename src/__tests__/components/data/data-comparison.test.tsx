import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataComparison from "@/components/data/data-comparison";
import { runQuery } from "@/lib/duckdb/client";
import type { DatasetMeta } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const datasets: DatasetMeta[] = [
  {
    id: "a",
    name: "Orders A",
    fileName: "orders-a.csv",
    rowCount: 100,
    columnCount: 3,
    uploadedAt: 1,
    sizeBytes: 1000,
    columns: [
      {
        name: "price",
        type: "number",
        nullCount: 0,
        uniqueCount: 10,
        sampleValues: [10, 20, 30],
      },
      {
        name: "category",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["A", "B"],
      },
      {
        name: "legacy_flag",
        type: "boolean",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: [true, false],
      },
    ],
  },
  {
    id: "b",
    name: "Orders B",
    fileName: "orders-b.csv",
    rowCount: 120,
    columnCount: 3,
    uploadedAt: 2,
    sizeBytes: 1200,
    columns: [
      {
        name: "price",
        type: "number",
        nullCount: 0,
        uniqueCount: 12,
        sampleValues: [12, 25, 40],
      },
      {
        name: "category",
        type: "string",
        nullCount: 0,
        uniqueCount: 5,
        sampleValues: ["A", "C"],
      },
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["Retail", "SMB"],
      },
    ],
  },
];

describe("DataComparison", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("compares two datasets after the user selects them", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM "orders_a"') && sql.includes('MIN("price")')) {
        return [{ mn: 10, mx: 30, avg_val: 20 }];
      }

      if (sql.includes('FROM "orders_b"') && sql.includes('MIN("price")')) {
        return [{ mn: 12, mx: 40, avg_val: 25 }];
      }

      if (sql.includes('FROM "orders_a"') && sql.includes('COUNT(DISTINCT "category")')) {
        return [{ uq: 3 }];
      }

      if (sql.includes('FROM "orders_b"') && sql.includes('COUNT(DISTINCT "category")')) {
        return [{ uq: 5 }];
      }

      if (sql.includes('FROM "orders_b"') && sql.includes('COUNT(DISTINCT "segment")')) {
        return [{ uq: 2 }];
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    render(<DataComparison datasets={datasets} />);

    const [leftSelector, rightSelector] = screen.getAllByRole("button", {
      name: /select dataset/i,
    });

    await user.click(leftSelector);
    await user.click(screen.getByRole("button", { name: /orders a/i }));

    await user.click(rightSelector);
    await user.click(screen.getAllByRole("button", { name: /orders b/i }).at(-1)!);

    expect(await screen.findByText("2 Common")).toBeInTheDocument();
    expect(screen.getByText("1 Only in A")).toBeInTheDocument();
    expect(screen.getByText("1 Only in B")).toBeInTheDocument();

    expect(screen.getByText("price")).toBeInTheDocument();
    expect(screen.getByText("price (min)")).toBeInTheDocument();
    expect(screen.getByText("price (max)")).toBeInTheDocument();
    expect(screen.getByText("category")).toBeInTheDocument();
    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(screen.getByText("legacy_flag")).toBeInTheDocument();
    expect(screen.getByText("segment")).toBeInTheDocument();
  });

  it("shows an error state when stats collection fails", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Comparison failed badly"));

    render(<DataComparison datasets={datasets} />);

    const [leftSelector, rightSelector] = screen.getAllByRole("button", {
      name: /select dataset/i,
    });

    await user.click(leftSelector);
    await user.click(screen.getByRole("button", { name: /orders a/i }));

    await user.click(rightSelector);
    await user.click(screen.getAllByRole("button", { name: /orders b/i }).at(-1)!);

    expect(await screen.findByText("Comparison failed badly")).toBeInTheDocument();
  });
});
