import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReportExportPanel from "@/components/report/report-export-panel";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Hardware", "Software"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 2,
    uniqueCount: 12,
    sampleValues: [100, 200],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ReportExportPanel tableName="orders" columns={columns} />);
  });
}

describe("ReportExportPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the HTML preview by default", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Report export panel",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Export preview")).toHaveTextContent("<!DOCTYPE html>");
    expect(screen.getAllByText("HTML").length).toBeGreaterThan(0);
  });

  it("switches to the JSON preview format", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(screen.getByLabelText("Export preview")).toHaveTextContent('"tableName": "orders"');
    expect(screen.getByLabelText("Export preview")).toHaveTextContent('"title": "Schema"');
  });

  it("excludes sections from the preview output", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("checkbox", { name: /Schema/i }));

    expect(screen.getByLabelText("Export preview")).not.toHaveTextContent("Schema");
  });

  it("downloads the selected export format", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "CSV" }));
    await user.click(screen.getByRole("button", { name: "Download export" }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("section,content"),
        "orders-report-export.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
