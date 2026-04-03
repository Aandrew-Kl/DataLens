import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnSplitter from "@/components/data/column-splitter";
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
    name: "full_name",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Ada,Lovelace"],
  },
  {
    name: "score",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<ColumnSplitter tableName="people" columns={columns} />);
  });
}

describe("ColumnSplitter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("previews split parts for the selected text column", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValueOnce([
      {
        original_value: "Ada,Lovelace",
        first_name: "Ada",
        last_name: "Lovelace",
      },
    ]);

    await renderComponent();

    fireEvent.change(
      screen.getByPlaceholderText("full_name_part_1, full_name_part_2"),
      {
        target: { value: "first_name,last_name" },
      },
    );

    await user.click(screen.getByRole("button", { name: /Preview split/i }));

    expect(await screen.findByText("Ada,Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Lovelace")).toBeInTheDocument();
  });

  it("creates a split table in DuckDB", async () => {
    const user = userEvent.setup();

    await renderComponent();

    fireEvent.change(
      screen.getByPlaceholderText("full_name_part_1, full_name_part_2"),
      {
        target: { value: "first_name,last_name" },
      },
    );
    fireEvent.change(screen.getByDisplayValue("people_split"), {
      target: { value: "people_enriched" },
    });

    await user.click(screen.getByRole("button", { name: /Apply split/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE OR REPLACE TABLE "people_enriched" AS SELECT *,'),
      );
    });
  });

  it("exports the split preview as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValueOnce([
      {
        original_value: "Ada,Lovelace",
        first_name: "Ada",
        last_name: "Lovelace",
      },
    ]);

    await renderComponent();

    fireEvent.change(
      screen.getByPlaceholderText("full_name_part_1, full_name_part_2"),
      {
        target: { value: "first_name,last_name" },
      },
    );
    await user.click(screen.getByRole("button", { name: /Preview split/i }));
    await screen.findByText("Lovelace");

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("original,first_name,last_name"),
      "people-full_name-split-preview.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
