import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataCatalogBrowser from "@/components/data/data-catalog-browser";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: (_target, tag) =>
          React.forwardRef(function MockMotion(
            props: Record<string, unknown> & { children?: ReactNode },
            ref: React.Ref<Element>,
          ) {
            return React.createElement(String(tag), { ...props, ref }, props.children);
          }),
      },
    ),
  };
});

const mockRunQuery = jest.mocked(runQuery);

const currentColumns: ColumnProfile[] = [
  {
    name: "order_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 120,
    sampleValues: [1, 2],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["won", "lost"],
  },
];

function installCatalogMock() {
  mockRunQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query.includes("FROM information_schema.tables")) {
      return [{ table_name: "sales" }, { table_name: "customers" }];
    }
    if (query.includes('COUNT(*) AS row_count FROM "sales"')) {
      return [{ row_count: 120 }];
    }
    if (query.includes('COUNT(*) AS row_count FROM "customers"')) {
      return [{ row_count: 20 }];
    }
    if (query.includes("table_name = 'sales'")) {
      return [{ column_name: "order_id" }, { column_name: "status" }];
    }
    if (query.includes("table_name = 'customers'")) {
      return [
        { column_name: "customer_id" },
        { column_name: "segment" },
        { column_name: "lifetime_value" },
      ];
    }
    return [];
  });
}

function getCardButton(label: string): HTMLButtonElement {
  const button = screen.getByText(label).closest("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button for ${label}`);
  }
  return button;
}

async function renderBrowser() {
  await act(async () => {
    render(<DataCatalogBrowser tableName="sales" columns={currentColumns} />);
  });
}

describe("DataCatalogBrowser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installCatalogMock();
  });

  it("refreshes the DuckDB catalog and shows table metadata", async () => {
    const user = userEvent.setup();

    await renderBrowser();
    await user.click(screen.getByRole("button", { name: /refresh catalog/i }));

    expect((await screen.findAllByText("sales")).length).toBeGreaterThan(0);
    expect(screen.getByText("customers")).toBeInTheDocument();
    expect(
      screen.getByText(/Catalog refreshed with 2 loaded tables/i),
    ).toBeInTheDocument();
  });

  it("filters the card grid using table and column search", async () => {
    const user = userEvent.setup();

    await renderBrowser();
    await user.click(screen.getByRole("button", { name: /refresh catalog/i }));
    fireEvent.change(screen.getByLabelText(/search datasets/i), {
      target: { value: "status" },
    });

    await waitFor(() => {
      expect(screen.getAllByText("sales").length).toBeGreaterThan(0);
      expect(screen.queryAllByText("customers")).toHaveLength(0);
    });
  });

  it("sorts by size and lets the user inspect a selected table", async () => {
    const user = userEvent.setup();

    await renderBrowser();
    await user.click(screen.getByRole("button", { name: /refresh catalog/i }));
    fireEvent.change(screen.getByLabelText(/sort catalog/i), {
      target: { value: "size" },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("catalog-card-title")[0]).toHaveTextContent("sales");
    });

    await user.click(getCardButton("customers"));

    expect(screen.getAllByText("customer_id").length).toBeGreaterThan(0);
    expect(screen.getByText(/20 rows across 3 columns/i)).toBeInTheDocument();
  });
});
