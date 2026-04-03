import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataSampler from "@/components/data/data-sampler";
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
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [1, 2, 3],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B", "C"],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<DataSampler tableName="orders" columns={targetColumns} />);
  });

  await waitFor(() => {
    expect(
      screen.queryByText("Loading sample preview…"),
    ).not.toBeInTheDocument();
  });
}

describe("DataSampler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when there are no columns", () => {
    render(<DataSampler tableName="orders" columns={[]} />);

    expect(
      screen.getByText("Sampling requires at least one profiled column."),
    ).toBeInTheDocument();
  });

  it("loads a seeded random preview", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("row_count")) {
        return [{ row_count: 1000 }];
      }
      if (sql.includes("sample_count")) {
        return [{ sample_count: 100 }];
      }
      if (sql.includes(`LIMIT 8`)) {
        return [
          { id: 1, segment: "A" },
          { id: 2, segment: "B" },
        ];
      }
      return [];
    });

    await renderAsync();

    expect(
      await screen.findByText("Seeded random sample with 100 rows."),
    ).toBeInTheDocument();
    expect(screen.getByText("Rows in dataset")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("exports the sampled CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("row_count")) {
        return [{ row_count: 1000 }];
      }
      if (sql.includes("sample_count")) {
        return [{ sample_count: 100 }];
      }
      if (sql.includes(`LIMIT 8`)) {
        return [{ id: 1, segment: "A" }];
      }
      return [
        { id: 1, segment: "A" },
        { id: 2, segment: "B" },
      ];
    });

    await renderAsync();

    await user.click(
      screen.getByRole("button", { name: /Download sampled CSV/i }),
    );

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        "id,segment\n1,A\n2,B",
        "orders-random-sample.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });

  it("surfaces sampling failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Sampling query failed"));

    await renderAsync();

    expect(
      await screen.findByText("Sampling query failed"),
    ).toBeInTheDocument();
  });
});
