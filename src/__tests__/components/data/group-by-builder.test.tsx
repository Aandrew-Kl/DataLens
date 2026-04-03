import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GroupByBuilder from "@/components/data/group-by-builder";
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
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [100, 200],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<GroupByBuilder tableName="sales" columns={columns} />);
  });
}

describe("GroupByBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates the generated SQL as grouping selections change", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("checkbox", { name: "region" }));

    expect(screen.getByText(/GROUP BY "region"/i)).toBeInTheDocument();
    expect(screen.getByText(/COUNT\(\*\) AS "count_rows"/i)).toBeInTheDocument();
  });

  it("executes the grouped query and previews the result rows", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ region: "East", count_rows: 3 }]);

    await renderAsync();
    await user.click(screen.getByRole("checkbox", { name: "region" }));
    await user.click(screen.getByRole("button", { name: "Execute GROUP BY" }));

    expect(await screen.findByText("East")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("exports the current grouped preview as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ region: "East", count_rows: 3 }]);

    await renderAsync();
    await user.click(screen.getByRole("checkbox", { name: "region" }));
    await user.click(screen.getByRole("button", { name: "Execute GROUP BY" }));
    await screen.findByText("East");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("region,count_rows"),
      "sales-group-by-results.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
