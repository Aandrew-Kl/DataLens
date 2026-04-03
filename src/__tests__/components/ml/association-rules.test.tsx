import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AssociationRules from "@/components/ml/association-rules";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "transaction_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["t1", "t2"],
  },
  {
    name: "item_name",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Milk", "Bread"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [1, 2, 3],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AssociationRules tableName="orders" columns={columns} />);
  });
}

describe("AssociationRules", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders mining controls and an empty rules table", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Mine market-basket patterns across transactions",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mine rules" })).toBeInTheDocument();
    expect(screen.getByText("Mine rules to populate the table.")).toBeInTheDocument();
  });

  it("mines directional rules and shows the strongest pair", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { transaction_id: "t1", item_value: "Milk" },
      { transaction_id: "t1", item_value: "Bread" },
      { transaction_id: "t2", item_value: "Milk" },
      { transaction_id: "t2", item_value: "Bread" },
      { transaction_id: "t3", item_value: "Milk" },
      { transaction_id: "t3", item_value: "Eggs" },
      { transaction_id: "t4", item_value: "Bread" },
      { transaction_id: "t4", item_value: "Eggs" },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Mine rules" }));

    expect(
      await screen.findByText("Mined 6 directional rules from 4 transactions."),
    ).toBeInTheDocument();
    expect(screen.getByText("Milk -> Bread")).toBeInTheDocument();
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);
  });

  it("exports the filtered rules as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { transaction_id: "t1", item_value: "Milk" },
      { transaction_id: "t1", item_value: "Bread" },
      { transaction_id: "t2", item_value: "Milk" },
      { transaction_id: "t2", item_value: "Bread" },
      { transaction_id: "t3", item_value: "Milk" },
      { transaction_id: "t3", item_value: "Eggs" },
      { transaction_id: "t4", item_value: "Bread" },
      { transaction_id: "t4", item_value: "Eggs" },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Mine rules" }));
    await screen.findByText("Mined 6 directional rules from 4 transactions.");

    await user.click(screen.getByRole("button", { name: "Export rules CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("antecedent,consequent,support,confidence,lift,pair_count"),
      "orders-association-rules.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
