import { render, screen } from "@testing-library/react";

import MissingDataMap from "@/components/data/missing-data-map";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 90,
    sampleValues: [10, 20, 30],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["open", "closed"],
  },
];

describe("MissingDataMap", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders a neutral empty state when no columns are available", () => {
    render(<MissingDataMap tableName="orders" columns={[]} rowCount={0} />);

    expect(screen.getByText("No columns available")).toBeInTheDocument();
  });

  it("renders completeness metrics and remediation suggestions", async () => {
    mockRunQuery.mockResolvedValue([
      {
        row_count: 100,
        c0_nulls: 10,
        c1_nulls: 100,
      },
    ]);

    render(<MissingDataMap tableName="orders" columns={columns} rowCount={100} />);

    expect(await screen.findByText("45.0%")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(
      screen.getByText(/Drop or backfill fully empty columns first: status/i),
    ).toBeInTheDocument();
  });

  it("shows the query error when completeness cannot be computed", async () => {
    mockRunQuery.mockRejectedValue(new Error("Missingness query failed"));

    render(<MissingDataMap tableName="orders" columns={columns} rowCount={100} />);

    expect(
      await screen.findByText("Missingness query failed"),
    ).toBeInTheDocument();
  });
});
