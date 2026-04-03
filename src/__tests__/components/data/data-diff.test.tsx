import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

import DataDiff from "@/components/data/data-diff";
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
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2, 3],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["open", "closed"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [10, 20, 30],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataDiff tableName="sales" columns={columns} />);
  });

  await waitFor(
    () => {
      expect(
        screen.queryByText("Loading comparison workspace…"),
      ).not.toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

function installDiffMock({
  withIdKey = true,
  distinctColumns = false,
}: {
  withIdKey?: boolean;
  distinctColumns?: boolean;
} = {}) {
  const describeSales = withIdKey
    ? ["id", "status", "amount"]
    : ["status", "amount"];
  const describeJanuary = distinctColumns ? ["legacy_code", "notes"] : describeSales;
  const describeFebruary = distinctColumns
    ? ["future_status", "delta_amount"]
    : withIdKey
      ? ["id", "status", "amount"]
      : ["status", "amount"];

  const results: Record<string, { summary: Record<string, number>; columnSummary: Record<string, number>; rows: Record<string, unknown>[] }> = {
    "__version_sales_january_1710000000": {
      summary: { added_count: 0, removed_count: 0, modified_count: 1 },
      columnSummary: { changes__status: 1, changes__amount: 1 },
      rows: [
        {
          diff_key: "legacy-1",
          change_type: "modified",
          left__status: "open",
          right__status: "archived",
          left__amount: 10,
          right__amount: 15,
        },
      ],
    },
    "__version_sales_february_1710000200": {
      summary: { added_count: 1, removed_count: 1, modified_count: 1 },
      columnSummary: { changes__status: 1, changes__amount: 1 },
      rows: [
        {
          diff_key: "current-1",
          change_type: "modified",
          left__status: "open",
          right__status: "closed",
          left__amount: 10,
          right__amount: 20,
        },
      ],
    },
  } as const;

  mockRunQuery.mockImplementation(async (sql) => {
    if (sql === "SHOW TABLES") {
      return [
        { name: "sales" },
        { name: "__version_sales_january_1710000000" },
        { name: "__version_sales_february_1710000200" },
      ];
    }

    if (sql.includes('DESCRIBE "sales"')) {
      return describeSales.map((column_name) => ({ column_name }));
    }

    if (sql.includes('DESCRIBE "__version_sales_january_1710000000"')) {
      return describeJanuary.map((column_name) => ({ column_name }));
    }

    if (sql.includes('DESCRIBE "__version_sales_february_1710000200"')) {
      return describeFebruary.map((column_name) => ({ column_name }));
    }

    const tableName = Object.keys(results).find((key) => sql.includes(`"${key}"`));
    if (!tableName) {
      return [];
    }

    if (sql.includes("COUNT(*) FILTER")) {
      return [results[tableName].summary];
    }

    if (sql.includes("SUM(CASE WHEN")) {
      return [results[tableName].columnSummary];
    }

    if (sql.includes("COALESCE(l.diff_key, r.diff_key) AS diff_key")) {
      return results[tableName].rows;
    }

    return [];
  });
}

describe("DataDiff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads the latest snapshot by default and renders row previews", async () => {
    installDiffMock();

    await renderAsync();

    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects[0]?.value).toBe("sales");
    expect(selects[1]?.value).toBe("__version_sales_february_1710000200");
    expect(selects[2]?.value).toBe("id");

    expect(screen.getByText("current-1")).toBeInTheDocument();
    expect(screen.getByText("2 changed columns")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.getAllByText("february snapshot").length).toBeGreaterThan(0);
  });

  it("shows the row-order warning when no shared key is available", async () => {
    installDiffMock({ withIdKey: false });

    await renderAsync();

    expect(
      screen.getByText(
        "Diff keys are based on row order because no shared key column was selected.",
      ),
    ).toBeInTheDocument();
  });

  it("switches to unified mode and exports the current diff as CSV", async () => {
    const user = userEvent.setup();
    installDiffMock();

    await renderAsync();

    await user.click(screen.getByRole("button", { name: /Unified/i }));

    expect(screen.getAllByText(/Left:/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Right:/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Export diff CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining(
        "diff_key,change_type,changed_columns,left__status,right__status,left__amount,right__amount",
      ),
      "sales-vs-__version_sales_february_1710000200-diff.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces an error when the compared datasets share no column names", async () => {
    installDiffMock({ distinctColumns: true });

    await renderAsync();

    expect(
      screen.getByText(
        "These tables do not share any column names, so a diff cannot be computed.",
      ),
    ).toBeInTheDocument();
  });

  it("reruns the diff when the right dataset changes", async () => {
    installDiffMock();

    await renderAsync();

    expect(screen.getByText("current-1")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[1] as HTMLSelectElement, {
        target: { value: "__version_sales_january_1710000000" },
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByText("Loading comparison workspace…"),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("legacy-1")).toBeInTheDocument();
    });
    expect(screen.queryByText("current-1")).not.toBeInTheDocument();
  });
});
