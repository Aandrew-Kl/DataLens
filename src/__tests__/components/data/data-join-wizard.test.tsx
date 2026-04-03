import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataJoinWizard from "@/components/data/data-join-wizard";
import { runQuery } from "@/lib/duckdb/client";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

const mockRunQuery = jest.mocked(runQuery);

describe("DataJoinWizard", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockImplementation(async (sql: string) => {
      if (sql === "SHOW TABLES") {
        return [{ name: "orders" }, { name: "customers" }, { name: "returns" }];
      }
      if (sql.includes('DESCRIBE "orders"')) {
        return [{ column_name: "customer_id" }, { column_name: "region" }];
      }
      if (sql.includes('DESCRIBE "customers"')) {
        return [{ column_name: "customer_id" }, { column_name: "segment" }];
      }
      if (sql.includes("LIMIT 50")) {
        return [
          {
            orders__customer_id: 1,
            orders__region: "East",
            customers__customer_id: 1,
            customers__segment: "Enterprise",
          },
        ];
      }
      return [];
    });
  });

  it("renders the initial join chain from the provided tables", () => {
    const user = userEvent.setup();

    render(
      <DataJoinWizard
        tables={["orders", "customers"]}
        onJoinComplete={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Build multi-table joins with preview-first validation",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("orders")).toHaveLength(2);
    expect(screen.getAllByText("customers")).toHaveLength(2);

    void user;
  });

  it("refreshes schemas from DuckDB", async () => {
    const user = userEvent.setup();

    render(
      <DataJoinWizard
        tables={["orders", "customers"]}
        onJoinComplete={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Refresh schemas" }));

    await waitFor(() => {
      expect(screen.getByText("Schemas refreshed from DuckDB.")).toBeInTheDocument();
    });
  });

  it("previews the join SQL and sample rows", async () => {
    const user = userEvent.setup();

    render(
      <DataJoinWizard
        tables={["orders", "customers"]}
        onJoinComplete={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Refresh schemas" }));
    await waitFor(() => {
      expect(screen.getByText("Schemas refreshed from DuckDB.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Preview join" }));

    await waitFor(() => {
      expect(screen.getByText("Join preview loaded.")).toBeInTheDocument();
    });

    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT 50"));
  });

  it("creates the joined table and passes the result through the callback", async () => {
    const user = userEvent.setup();
    const onJoinComplete = jest.fn();

    render(
      <DataJoinWizard
        tables={["orders", "customers"]}
        onJoinComplete={onJoinComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Refresh schemas" }));
    await waitFor(() => {
      expect(screen.getByText("Schemas refreshed from DuckDB.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Preview join" }));

    await waitFor(() => {
      expect(screen.getByText("Join preview loaded.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Name result" }));
    fireEvent.change(screen.getByDisplayValue("joined_result"), {
      target: { value: "Revenue Join 2026" },
    });
    await user.click(screen.getByRole("button", { name: "Create joined table" }));

    await waitFor(() => {
      expect(onJoinComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          tableName: "revenue_join_2026",
          columns: [
            "orders__customer_id",
            "orders__region",
            "customers__customer_id",
            "customers__segment",
          ],
        }),
      );
    });
  });
});
