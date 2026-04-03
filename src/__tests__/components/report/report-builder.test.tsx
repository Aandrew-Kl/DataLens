import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReportBuilder from "@/components/report/report-builder";
import { runQuery } from "@/lib/duckdb/client";
import { generateReportHTML } from "@/lib/utils/report-export";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/utils/report-export", () => ({
  generateReportHTML: jest.fn(() => "<html><body>report</body></html>"),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockGenerateReportHTML =
  generateReportHTML as jest.MockedFunction<typeof generateReportHTML>;

const columns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Hardware", "Software"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [1200, 800],
  },
];

const dataset: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "sales-data.csv",
  rowCount: 120,
  columnCount: 2,
  columns,
  uploadedAt: 1,
  sizeBytes: 2048,
};

describe("ReportBuilder", () => {
  let createObjectURLSpy: jest.SpyInstance<string, [Blob | MediaSource]>;
  let revokeObjectURLSpy: jest.SpyInstance<void, [string]>;
  let anchorClickSpy: jest.SpyInstance<void, []>;

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockGenerateReportHTML.mockClear();
    createObjectURLSpy = jest
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:report");
    revokeObjectURLSpy = jest
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    anchorClickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    anchorClickSpy.mockRestore();
  });

  it("keeps preview and export disabled until widgets exist", async () => {
    const user = userEvent.setup();
    void user;

    render(<ReportBuilder dataset={dataset} columns={columns} />);

    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export HTML" })).toBeDisabled();
  });

  it("adds chart widgets to the stack", async () => {
    const user = userEvent.setup();
    void user;

    render(<ReportBuilder dataset={dataset} columns={columns} />);

    fireEvent.click(screen.getByRole("button", { name: "Add chart" }));

    await waitFor(() => {
      expect(screen.getByText("Chart widget added.")).toBeInTheDocument();
      expect(screen.getByText("Revenue by category")).toBeInTheDocument();
    });
  });

  it("previews text, chart, and KPI widgets using DuckDB data", async () => {
    const user = userEvent.setup();
    void user;

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('sum("revenue") AS value')) {
        return [{ value: 2500 }];
      }
      return [{ category: "Hardware", revenue: 1200 }];
    });

    render(<ReportBuilder dataset={dataset} columns={columns} />);

    fireEvent.click(screen.getByRole("button", { name: "Add chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    fireEvent.click(screen.getByRole("button", { name: "Add KPI" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Preview refreshed from DuckDB.")).toBeInTheDocument();
      expect(screen.getByText("Narrative block")).toBeInTheDocument();
      expect(screen.getAllByText("Total value")).toHaveLength(2);
      expect(screen.getByText("2,500")).toBeInTheDocument();
      expect(screen.getByText("Hardware")).toBeInTheDocument();
    });
  });

  it("removes widgets from the stack", async () => {
    const user = userEvent.setup();
    void user;

    render(<ReportBuilder dataset={dataset} columns={columns} />);

    fireEvent.click(screen.getByRole("button", { name: "Add chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));

    expect(screen.getAllByLabelText("Remove widget")).toHaveLength(2);

    fireEvent.click(screen.getAllByLabelText("Remove widget")[0]);

    await waitFor(() => {
      expect(screen.getAllByLabelText("Remove widget")).toHaveLength(1);
      expect(screen.queryByText("Revenue by category")).not.toBeInTheDocument();
    });
  });

  it("exports a standalone HTML report", async () => {
    const user = userEvent.setup();
    void user;

    mockRunQuery.mockResolvedValueOnce([{ category: "Hardware", revenue: 1200 }]);

    render(<ReportBuilder dataset={dataset} columns={columns} />);

    fireEvent.click(screen.getByRole("button", { name: "Add chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Export HTML" }));

    await waitFor(() => {
      expect(mockGenerateReportHTML).toHaveBeenCalledTimes(1);
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Standalone HTML report exported.")).toBeInTheDocument();
    });
  });
});
