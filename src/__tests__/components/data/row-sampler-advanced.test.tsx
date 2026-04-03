import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RowSamplerAdvanced from "@/components/data/row-sampler-advanced";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

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
    uniqueCount: 3,
    sampleValues: ["A", "B", "C"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: [120, 200, 350],
  },
];

async function renderSampler(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(<RowSamplerAdvanced tableName="orders" columns={targetColumns} />);
  });
}

describe("RowSamplerAdvanced", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows an empty state when there are no columns", async () => {
    await renderSampler([]);

    expect(
      screen.getByText("Sampling requires at least one profiled column."),
    ).toBeInTheDocument();
  });

  it("previews a stratified sample with a filter expression", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 40 }];
      }
      if (sql.includes("COUNT(*) AS sample_count")) {
        return [{ sample_count: 8 }];
      }
      if (sql.includes(`LIMIT 8`)) {
        return [
          { segment: "A", revenue: 120 },
          { segment: "B", revenue: 240 },
        ];
      }
      return [];
    });

    await renderSampler();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /sampling method/i }),
      "stratified",
    );
    await user.type(
      screen.getByRole("textbox", { name: /filter expression/i }),
      "status = 'active'",
    );
    await user.click(screen.getByRole("button", { name: /preview sample/i }));

    expect(
      await screen.findAllByText(
        "Seed datalens produced 8 stratified rows from 40 filtered rows using segment. Filtered with: status = 'active'.",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
    );
  });

  it("exports the sampled CSV after previewing a weighted sample", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 20 }];
      }
      if (sql.includes("COUNT(*) AS sample_count")) {
        return [{ sample_count: 2 }];
      }
      if (sql.includes(`LIMIT 8`)) {
        return [
          { segment: "A", revenue: 120 },
          { segment: "B", revenue: 240 },
        ];
      }
      return [
        { segment: "A", revenue: 120 },
        { segment: "B", revenue: 240 },
      ];
    });

    await renderSampler();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /sampling method/i }),
      "weighted",
    );
    await user.click(screen.getByRole("button", { name: /preview sample/i }));
    expect(await screen.findAllByText(/weight-ranked rows/i)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        "segment,revenue\nA,120\nB,240",
        "orders-weighted-advanced-sample.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
