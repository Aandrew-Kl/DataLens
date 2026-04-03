import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import EncodingDetector from "@/components/data/encoding-detector";
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
    name: "notes",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["FranÃ§ois"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<EncodingDetector tableName="orders" columns={columns} />);
  });
}

describe("EncodingDetector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scans a text column and suggests a conversion profile", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([{ issue_count: 2 }])
      .mockResolvedValueOnce([{ raw_value: "FranÃ§ois" }]);

    await renderComponent();

    await user.click(screen.getByRole("button", { name: /Scan column/i }));

    expect(await screen.findByText("FranÃ§ois")).toBeInTheDocument();
    expect(screen.getByText("François")).toBeInTheDocument();
    expect(
      screen.getByText(/Suggested profile: Latin-1 to UTF-8/i),
    ).toBeInTheDocument();
  });

  it("creates a converted output table", async () => {
    const user = userEvent.setup();

    await renderComponent();

    fireEvent.change(screen.getByDisplayValue("orders_encoded"), {
      target: { value: "orders_clean" },
    });
    fireEvent.change(screen.getByLabelText("Encoding profile"), {
      target: { value: "windows1252_cleanup" },
    });

    await user.click(screen.getByRole("button", { name: /Convert encoding/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE OR REPLACE TABLE "orders_clean" AS SELECT'),
      );
    });
  });

  it("exports the encoding preview as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([{ issue_count: 1 }])
      .mockResolvedValueOnce([{ raw_value: "FranÃ§ois" }]);

    await renderComponent();

    await user.click(screen.getByRole("button", { name: /Scan column/i }));
    await screen.findByText("François");

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("original,converted"),
      "orders-notes-encoding-preview.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
