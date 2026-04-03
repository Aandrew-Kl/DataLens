import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataSummarizer from "@/components/data/data-summarizer";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 5,
    uniqueCount: 80,
    sampleValues: [1200, 900],
    min: 100,
    max: 5000,
    mean: 1400,
    median: 1100,
  },
  {
    name: "customer_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["C-100", "C-101"],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["New", "Won"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["2026-01-01", "2026-01-02"],
    min: "2026-01-01",
    max: "2026-03-31",
  },
  {
    name: "mystery",
    type: "unknown",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: ["x", "y"],
  },
];

describe("DataSummarizer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders dataset metrics and deterministic findings", () => {
    render(<DataSummarizer tableName="orders" columns={columns} rowCount={100} />);

    expect(
      screen.getByRole("heading", { name: "Auto-generated narrative for orders" }),
    ).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("High overall completeness")).toBeInTheDocument();
    expect(screen.getByText("customer_id looks like a reliable key")).toBeInTheDocument();
    expect(screen.getByText("mystery needs manual typing")).toBeInTheDocument();
  });

  it("copies the plain-text summary to the clipboard", async () => {
    const user = userEvent.setup();
    const clipboard = {
      writeText: jest.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });

    render(<DataSummarizer tableName="orders" columns={columns} rowCount={100} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Executive Summary: orders"),
    );
    expect(screen.getByText("Summary copied to clipboard.")).toBeInTheDocument();
  });

  it("exports the executive summary as Markdown", async () => {
    const user = userEvent.setup();

    render(<DataSummarizer tableName="orders" columns={columns} rowCount={100} />);

    await user.click(screen.getByRole("button", { name: /export markdown/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("# Executive Summary: orders"),
      "orders-executive-summary.md",
      "text/markdown;charset=utf-8",
    );
    expect(screen.getByText("Exported executive summary as MD.")).toBeInTheDocument();
  });

  it("exports the executive summary as plain text", async () => {
    const user = userEvent.setup();

    render(<DataSummarizer tableName="orders" columns={columns} rowCount={100} />);

    await user.click(screen.getByRole("button", { name: /export text/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Executive Summary: orders"),
      "orders-executive-summary.txt",
      "text/plain;charset=utf-8",
    );
    expect(screen.getByText("Exported executive summary as TXT.")).toBeInTheDocument();
  });

  it("opens the column snapshot section on demand", async () => {
    const user = userEvent.setup();

    render(<DataSummarizer tableName="orders" columns={columns} rowCount={100} />);

    expect(screen.queryByText("Missing rate")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /column snapshots/i }));

    expect(screen.getAllByText("Missing rate").length).toBeGreaterThan(0);
  });
});
