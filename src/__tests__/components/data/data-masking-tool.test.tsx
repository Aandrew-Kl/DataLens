import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataMaskingTool from "@/components/data/data-masking-tool";
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
    name: "email",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["alice@example.com"],
  },
  {
    name: "customer_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<DataMaskingTool tableName="customers" columns={columns} />);
  });
}

describe("DataMaskingTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("previews masked rows for the selected column", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValueOnce([
      {
        email__original: "alice@example.com",
        email__masked: "5f4dcc3b5aa765d61d8327deb882cf99",
      },
    ]);

    await renderComponent();

    await user.click(screen.getByRole("button", { name: "email" }));
    await user.click(screen.getByRole("button", { name: /Preview masked rows/i }));

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("5f4dcc3b5aa765d61d8327deb882cf99"),
    ).toBeInTheDocument();
  });

  it("creates a masked table in DuckDB", async () => {
    const user = userEvent.setup();

    await renderComponent();

    await user.click(screen.getByRole("button", { name: "email" }));
    fireEvent.change(screen.getByDisplayValue("customers_masked"), {
      target: { value: "customers_private" },
    });

    await user.click(screen.getByRole("button", { name: /Apply to DuckDB/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE OR REPLACE TABLE "customers_private" AS SELECT'),
      );
    });
  });

  it("exports preview rows as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValueOnce([
      {
        email__original: "alice@example.com",
        email__masked: "[REDACTED]",
      },
    ]);

    await renderComponent();

    await user.click(screen.getByRole("button", { name: "email" }));
    fireEvent.change(screen.getByLabelText("email masking strategy"), {
      target: { value: "redact" },
    });
    await user.click(screen.getByRole("button", { name: /Preview masked rows/i }));
    await screen.findByText("[REDACTED]");

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("row,column,strategy,original,masked"),
      "customers-masked-preview.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
