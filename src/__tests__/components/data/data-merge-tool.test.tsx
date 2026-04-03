import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DataMergeTool from "@/components/data/data-merge-tool";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "customer_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["North", "South"],
  },
];

function installMergeMock() {
  mockRunQuery.mockImplementation(async (sql: string) => {
    if (sql === "SHOW TABLES") {
      return [{ name: "orders" }, { name: "customers" }, { name: "sales" }];
    }
    if (sql.includes('DESCRIBE "orders"')) {
      return [{ column_name: "customer_id" }, { column_name: "region" }];
    }
    if (sql.includes('DESCRIBE "customers"')) {
      return [{ column_name: "customer_id" }, { column_name: "segment" }];
    }
    if (sql.includes('DESCRIBE "sales"')) {
      return [{ column_name: "customer_id" }, { column_name: "region" }];
    }
    if (sql.includes('COUNT(*) AS row_count FROM "orders"')) {
      return [{ row_count: 8 }];
    }
    if (sql.includes('COUNT(*) AS row_count FROM "customers"')) {
      return [{ row_count: 4 }];
    }
    if (sql.includes('COUNT(*) AS row_count FROM "sales"')) {
      return [{ row_count: 6 }];
    }
    if (sql.includes("INTERSECT")) {
      return [{ customer_id: 2, region: "North" }];
    }
    if (sql.includes("UNION ALL")) {
      return [{ customer_id: 1, region: "North" }];
    }
    if (sql.includes("CREATE OR REPLACE TABLE")) {
      return [];
    }
    return [];
  });
}

async function renderAsync() {
  await act(async () => {
    render(<DataMergeTool tableName="sales" columns={columns} />);
  });

  await waitFor(() => {
    expect(screen.getByText("Merge multiple DuckDB tables with set-based strategies")).toBeInTheDocument();
  });
}

describe("DataMergeTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installMergeMock();
  });

  it("loads the DuckDB table catalog and row counts", async () => {
    await renderAsync();

    expect(screen.getAllByText("orders").length).toBeGreaterThan(0);
    expect(screen.getAllByText("customers").length).toBeGreaterThan(0);
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("previews an intersect merge strategy", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "intersect" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    await waitFor(() => {
      expect(screen.getByText("North")).toBeInTheDocument();
    });
    expect(mockRunQuery).toHaveBeenCalledWith(expect.stringContaining("INTERSECT"));
  });

  it("executes the merge and reports the created table name", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByDisplayValue("sales_merged"), {
        target: { value: "executive_merge" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Created executive_merge.")).toBeInTheDocument();
    });
  });
});
