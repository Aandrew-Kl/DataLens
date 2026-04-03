import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WindowFunctionBuilder from "@/components/data/window-function-builder";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({ downloadFile: jest.fn() }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["2025-01-01", "2025-01-02"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [100, 120],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<WindowFunctionBuilder tableName="sales" columns={columns} />);
  });
}

describe("WindowFunctionBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates the SQL when selecting lag over an order column", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.selectOptions(screen.getByLabelText("Window function"), "LAG");
    await user.selectOptions(screen.getByLabelText("Target column"), "revenue");
    await user.selectOptions(screen.getByLabelText("Order column"), "created_at");

    expect(screen.getByText(/LAG\("revenue", 1\) OVER \(ORDER BY "created_at"\)/i)).toBeInTheDocument();
  });

  it("executes the window query and renders preview rows", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { created_at: "2025-01-01", region: "East", revenue: 100, window_value: 1 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Execute window query" }));

    expect(await screen.findByText("East")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("exports the current window preview as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { created_at: "2025-01-01", region: "East", revenue: 100, window_value: 1 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Execute window query" }));
    await screen.findByText("East");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("created_at,region,revenue,window_value"),
      "sales-window-results.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
