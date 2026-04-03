import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MergeDatasets from "@/components/data/merge-datasets";
import { runQuery } from "@/lib/duckdb/client";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

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

const leftColumns: ColumnProfile[] = [
  {
    name: "customer_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [100, 120],
  },
];

const rightColumns: ColumnProfile[] = [
  {
    name: "customer_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Enterprise", "SMB"],
  },
];

const seededDatasets: DatasetMeta[] = [
  {
    id: "orders-dataset",
    name: "orders",
    fileName: "orders.csv",
    rowCount: 3,
    columnCount: leftColumns.length,
    columns: leftColumns,
    uploadedAt: 1,
    sizeBytes: 128,
  },
  {
    id: "customers-dataset",
    name: "customers",
    fileName: "customers.csv",
    rowCount: 3,
    columnCount: rightColumns.length,
    columns: rightColumns,
    uploadedAt: 2,
    sizeBytes: 128,
  },
];

describe("MergeDatasets", () => {
  beforeEach(() => {
    useDatasetStore.setState({
      datasets: seededDatasets,
      activeDatasetId: "customers-dataset",
    });
    mockRunQuery.mockReset();
    mockRunQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("merged_preview")) {
        return [{ customer_id: 1, revenue: 100, segment: "Enterprise" }];
      }
      if (sql.includes("merged_stats")) {
        return [{ row_count: 5, null_fill_rate: 0.1 }];
      }
      return [];
    });
  });

  it("renders the merge wizard with seeded datasets", () => {
    const user = userEvent.setup();

    render(<MergeDatasets onMergeComplete={jest.fn()} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Step-by-step merge wizard",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("customers")).toBeInTheDocument();

    void user;
  });

  it("previews an append-rows result and statistics", async () => {
    const user = userEvent.setup();

    render(<MergeDatasets onMergeComplete={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Review preview" }));
    await user.click(screen.getByRole("button", { name: "Preview 50 rows" }));

    await waitFor(() => {
      expect(screen.getByText("Enterprise")).toBeInTheDocument();
    });

    expect(screen.getByText("Result statistics")).toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
  });

  it("switches to join-by-column and shows the join SQL plan", async () => {
    const user = userEvent.setup();

    render(<MergeDatasets onMergeComplete={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: /Join by column/ }));
    await user.click(screen.getByRole("button", { name: "Next step" }));

    expect(screen.getByText("Join projection")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review preview" }));

    expect(screen.getByText(/LEFT JOIN "customers" t1/)).toBeInTheDocument();
  });

  it("creates the merged table and calls the completion callback", async () => {
    const user = userEvent.setup();
    const onMergeComplete = jest.fn();

    render(<MergeDatasets onMergeComplete={onMergeComplete} />);

    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Review preview" }));

    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "executive_merge" },
    });
    await user.click(screen.getByRole("button", { name: "Create merged table" }));

    await waitFor(() => {
      expect(onMergeComplete).toHaveBeenCalledWith("executive_merge");
    });

    expect(screen.getByText("Created executive_merge.")).toBeInTheDocument();
  });
});
