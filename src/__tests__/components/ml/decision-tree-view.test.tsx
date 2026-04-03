import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DecisionTreeView from "@/components/ml/decision-tree-view";
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
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Enterprise", "SMB"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: [100, 105],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: [30, 33],
  },
  {
    name: "orders",
    type: "number",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: [3, 4],
  },
];

const trainingRows = [
  ...Array.from({ length: 12 }, (_, index) => ({
    target_label: "Enterprise",
    revenue: 100 + index,
    profit: 30 + index,
    orders: 3 + index * 0.2,
  })),
  ...Array.from({ length: 12 }, (_, index) => ({
    target_label: "SMB",
    revenue: 240 + index,
    profit: 90 + index,
    orders: 16 + index * 0.2,
  })),
];

async function renderAsync() {
  await act(async () => {
    render(<DecisionTreeView tableName="orders" columns={columns} />);
  });
}

describe("DecisionTreeView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the decision tree controls", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Build a CART-style decision tree from your dataset",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Train tree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export tree" })).toBeDisabled();
  });

  it("trains a tree and renders leaf predictions", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(trainingRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Train tree" }));

    expect(await screen.findByText(/Holdout accuracy is/i)).toBeInTheDocument();
    expect(screen.getAllByText("Leaf prediction").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Enterprise|SMB/).length).toBeGreaterThan(0);
  });

  it("exports the trained tree structure", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(trainingRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Train tree" }));
    await screen.findByText(/Holdout accuracy is/i);

    await user.click(screen.getByRole("button", { name: "Export tree" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining('"targetColumn": "segment"'),
      "orders-decision-tree.json",
      "application/json;charset=utf-8;",
    );
  });
});
