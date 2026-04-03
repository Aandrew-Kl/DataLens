import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataCatalog from "@/components/data/data-catalog";
import { dropTable, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { exportToCSV } from "@/lib/utils/export";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  dropTable: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/duckdb/profiler", () => ({
  profileTable: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockDropTable = dropTable as jest.MockedFunction<typeof dropTable>;
const mockProfileTable = profileTable as jest.MockedFunction<typeof profileTable>;
const mockExportToCSV = exportToCSV as jest.MockedFunction<typeof exportToCSV>;

const profileColumns: ColumnProfile[] = [
  {
    name: "order_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 25,
    sampleValues: [1, 2],
  },
  {
    name: "customer_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [101, 102],
  },
];

const datasets: DatasetMeta[] = [
  {
    id: "orders-id",
    name: "orders",
    fileName: "orders.csv",
    rowCount: 25,
    columnCount: 3,
    uploadedAt: Date.UTC(2026, 0, 5),
    sizeBytes: 4096,
    columns: profileColumns,
  },
  {
    id: "customers-id",
    name: "customers",
    fileName: "customers.csv",
    rowCount: 8,
    columnCount: 2,
    uploadedAt: Date.UTC(2026, 0, 6),
    sizeBytes: 2048,
    columns: [
      {
        name: "customer_id",
        type: "number",
        nullCount: 0,
        uniqueCount: 8,
        sampleValues: [101, 102],
      },
      {
        name: "lifetime_value",
        type: "number",
        nullCount: 0,
        uniqueCount: 8,
        sampleValues: [1000, 1200],
      },
    ],
  },
];

let availableTables: string[] = [];

function installCatalogQueryMock() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("FROM information_schema.tables")) {
      return availableTables.map((tableName) => ({ table_name: tableName }));
    }

    if (sql.includes('SELECT COUNT(*) AS row_count FROM "orders"')) {
      return [{ row_count: 25 }];
    }

    if (sql.includes('SELECT COUNT(*) AS row_count FROM "customers"')) {
      return [{ row_count: 8 }];
    }

    if (sql.includes("table_name = 'orders'")) {
      return [
        { column_name: "order_id", data_type: "BIGINT" },
        { column_name: "customer_id", data_type: "BIGINT" },
        { column_name: "status", data_type: "VARCHAR" },
      ];
    }

    if (sql.includes("table_name = 'customers'")) {
      return [
        { column_name: "customer_id", data_type: "BIGINT" },
        { column_name: "lifetime_value", data_type: "DOUBLE" },
      ];
    }

    if (sql.includes('SELECT * FROM "orders" LIMIT 10')) {
      return [
        { order_id: 1, customer_id: 101, status: "pending" },
        { order_id: 2, customer_id: 102, status: "won" },
      ];
    }

    if (sql.includes('SELECT * FROM "orders"')) {
      return [
        { order_id: 1, customer_id: 101, status: "pending" },
        { order_id: 2, customer_id: 102, status: "won" },
      ];
    }

    if (sql.includes("CREATE OR REPLACE TABLE")) {
      return [];
    }

    return [];
  });
}

function getCard(tableName: string): HTMLElement {
  const article = screen.getByText(tableName).closest("article");
  if (!article) {
    throw new Error(`Expected card for ${tableName}`);
  }
  return article;
}

async function renderAndRefreshCatalog() {
  const user = userEvent.setup();
  render(<DataCatalog />);
  await user.click(screen.getByRole("button", { name: /Refresh catalog/i }));
  await screen.findByText("orders");
  await screen.findByText("customers");
  return user;
}

describe("DataCatalog", () => {
  beforeEach(() => {
    availableTables = ["orders", "customers"];
    window.localStorage.clear();

    mockRunQuery.mockReset();
    mockDropTable.mockReset();
    mockProfileTable.mockReset();
    mockExportToCSV.mockReset();

    installCatalogQueryMock();

    mockDropTable.mockImplementation(async (tableName) => {
      availableTables = availableTables.filter((entry) => entry !== tableName);
    });

    mockProfileTable.mockResolvedValue([
      ...profileColumns,
      {
        name: "priority",
        type: "string",
        nullCount: 1,
        uniqueCount: 3,
        sampleValues: ["low", "high"],
      },
    ]);

    useDatasetStore.setState({
      datasets,
      activeDatasetId: "orders-id",
    });
  });

  it("loads catalog items from DuckDB metadata", async () => {
    await renderAndRefreshCatalog();

    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("customers")).toBeInTheDocument();
    expect(screen.getByText(/25 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/8 rows/i)).toBeInTheDocument();
  });

  it("saves tags and filters tables using the search box", async () => {
    const user = await renderAndRefreshCatalog();

    fireEvent.change(within(getCard("orders")).getByPlaceholderText("Add a tag"), {
      target: { value: "finance" },
    });
    await user.click(
      within(getCard("orders")).getByRole("button", { name: /Save tag/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("finance")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Search tables, columns, or tags"), {
      target: { value: "finance" },
    });

    await waitFor(() => {
      expect(screen.getByText("orders")).toBeInTheDocument();
      expect(screen.queryByText("customers")).not.toBeInTheDocument();
    });
  });

  it("previews rows and profiles a selected table", async () => {
    const user = await renderAndRefreshCatalog();

    await user.click(within(getCard("orders")).getAllByRole("button")[0]);
    expect(await screen.findByText("pending")).toBeInTheDocument();

    await user.click(within(getCard("customers")).getAllByRole("button")[1]);
    expect(await screen.findByText("priority")).toBeInTheDocument();
    expect(screen.getAllByText("customer_id").length).toBeGreaterThan(0);
  });

  it("exports rows and deletes tables from the catalog", async () => {
    const user = await renderAndRefreshCatalog();

    await user.click(within(getCard("orders")).getAllByRole("button")[2]);

    await waitFor(() => {
      expect(mockExportToCSV).toHaveBeenCalledWith(
        [
          { order_id: 1, customer_id: 101, status: "pending" },
          { order_id: 2, customer_id: 102, status: "won" },
        ],
        "orders.csv",
      );
    });

    await user.click(within(getCard("customers")).getAllByRole("button")[3]);

    await waitFor(() => {
      expect(mockDropTable).toHaveBeenCalledWith("customers");
      expect(screen.queryByText("customers")).not.toBeInTheDocument();
      expect(useDatasetStore.getState().datasets.map((dataset) => dataset.name)).toEqual([
        "orders",
      ]);
    });
  });
});
