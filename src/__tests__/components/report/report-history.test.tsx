import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReportHistory from "@/components/report/report-history";
import { downloadFile } from "@/lib/utils/export";

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockDownloadFile = jest.mocked(downloadFile);

async function renderAsync() {
  await act(async () => {
    render(<ReportHistory />);
  });
}

describe("ReportHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders the empty archive state when nothing is stored", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Review generated reports and keep the archive lean",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /No generated reports are stored yet\. Once reports are saved to localStorage/i,
      ),
    ).toBeInTheDocument();
  });

  it("filters the archive by template family", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens-report-history",
      JSON.stringify([
        {
          id: "entry-1",
          reportName: "Weekly executive summary",
          templateId: "executive-summary",
          generatedAt: Date.UTC(2026, 2, 20),
          rowCount: 420,
          mimeType: "text/markdown;charset=utf-8;",
          content: "# Executive",
        },
        {
          id: "entry-2",
          reportName: "March trend watch",
          templateId: "trend-analysis",
          generatedAt: Date.UTC(2026, 2, 25),
          rowCount: 512,
          mimeType: "text/markdown;charset=utf-8;",
          content: "# Trend",
        },
      ]),
    );

    await renderAsync();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Template filter" }),
      "trend-analysis",
    );

    expect(screen.getByText("March trend watch")).toBeInTheDocument();
    expect(screen.queryByText("Weekly executive summary")).not.toBeInTheDocument();
  });

  it("downloads an archived report using the generated filename", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens-report-history",
      JSON.stringify([
        {
          id: "entry-1",
          reportName: "Weekly executive summary",
          templateId: "executive-summary",
          generatedAt: Date.UTC(2026, 2, 5),
          rowCount: 420,
          mimeType: "text/markdown;charset=utf-8;",
          content: "# Executive",
        },
      ]),
    );

    await renderAsync();

    const row = screen.getByText("Weekly executive summary").closest("tr");
    expect(row).not.toBeNull();

    await user.click(
      within(row as HTMLElement).getByRole("button", { name: "Download" }),
    );

    expect(mockDownloadFile).toHaveBeenCalledWith(
      "# Executive",
      "weekly-executive-summary-2026-03-05.md",
      "text/markdown;charset=utf-8;",
    );
  });

  it("deletes reports older than 30 days from the archive", async () => {
    const user = userEvent.setup();
    const dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 3, 3));

    window.localStorage.setItem(
      "datalens-report-history",
      JSON.stringify([
        {
          id: "fresh",
          reportName: "April operations snapshot",
          templateId: "data-quality-report",
          generatedAt: Date.UTC(2026, 2, 30),
          rowCount: 200,
          mimeType: "text/markdown;charset=utf-8;",
          content: "# Fresh",
        },
        {
          id: "old",
          reportName: "January operations snapshot",
          templateId: "data-quality-report",
          generatedAt: Date.UTC(2026, 0, 1),
          rowCount: 180,
          mimeType: "text/markdown;charset=utf-8;",
          content: "# Old",
        },
      ]),
    );

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Delete older than 30 days" }));

    expect(screen.getByText("April operations snapshot")).toBeInTheDocument();
    expect(screen.queryByText("January operations snapshot")).not.toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("datalens-report-history") ?? "[]"),
    ).toHaveLength(1);

    dateNowSpy.mockRestore();
  });
});
