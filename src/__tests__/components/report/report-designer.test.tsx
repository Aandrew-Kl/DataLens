import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportDesigner from "@/components/report/report-designer";
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
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["North", "South"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [100, 200],
  },
  {
    name: "margin",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ReportDesigner tableName="orders" columns={columns} />);
  });
}

describe("ReportDesigner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds a preview with DuckDB-backed chart and table sections", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("AVG(")) {
        return [
          { label: "North", value: 120 },
          { label: "South", value: 95 },
        ];
      }
      if (sql.includes("LIMIT 8")) {
        return [{ region: "North", revenue: 120, margin: 20 }];
      }
      return [];
    });

    await renderAsync();

    await user.click(screen.getByRole("button", { name: /Add title/i }));
    await user.click(screen.getByRole("button", { name: /Add chart/i }));
    await user.click(screen.getByRole("button", { name: /Add table/i }));
    await user.click(screen.getByRole("button", { name: /^Preview$/i }));

    expect(await screen.findByText(/Preview refreshed from DuckDB/i)).toBeInTheDocument();
    expect(await screen.findAllByText("North")).toHaveLength(2);
    expect(await screen.findByText("120.00")).toBeInTheDocument();
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledTimes(2);
  });

  it("reorders and removes sections in designer mode", async () => {
    const user = userEvent.setup();

    await renderAsync();

    await user.click(screen.getByRole("button", { name: /Add title/i }));
    await user.click(screen.getByRole("button", { name: /Add narrative/i }));

    fireEvent.click(screen.getAllByLabelText("Move section up")[1]!);

    const reorderedCards = screen.getAllByTestId("section-card");
    expect(reorderedCards[0]).toHaveTextContent("Analyst note");

    fireEvent.click(screen.getAllByLabelText("Remove section")[0]!);

    await waitFor(() => {
      expect(screen.getAllByTestId("section-card")).toHaveLength(1);
    });
  });

  it("exports the current layout as HTML", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: /Add title/i }));
    await user.click(screen.getByRole("button", { name: /Export HTML/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("<!DOCTYPE html>")]),
      "orders-report-designer.html",
      "text/html;charset=utf-8;",
    );
  });
});
