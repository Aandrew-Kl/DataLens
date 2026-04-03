import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataTransposeTool from "@/components/data/data-transpose-tool";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [50, 90],
  },
] as ColumnProfile[];

async function renderTranspose(overrideColumns = columns) {
  await act(async () => {
    render(<DataTransposeTool tableName="metrics" columns={overrideColumns} />);
  });
}

describe("DataTransposeTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the minimum-columns fallback when fewer than two columns are provided", async () => {
    const singleColumn = [
      {
        name: "id",
        type: "number",
        nullCount: 0,
        uniqueCount: 5,
        sampleValues: [1],
      },
    ] as ColumnProfile[];

    await renderTranspose(singleColumn);

    expect(
      screen.getByText(
        "Transposition requires an identifier column plus at least one value column.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the identifier radio buttons and value checkboxes for the provided columns", async () => {
    await renderTranspose();

    expect(
      screen.getByText("Flip row values into DuckDB-generated columns"),
    ).toBeInTheDocument();
    expect(screen.getByText("Identifier column")).toBeInTheDocument();
    expect(screen.getByText("Value columns")).toBeInTheDocument();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
  });

  it("transposes data and displays the result table", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([
        { entity_id: "East" },
        { entity_id: "West" },
      ])
      .mockResolvedValueOnce([
        { metric_name: "sales", East: "100", West: "200" },
        { metric_name: "profit", East: "50", West: "90" },
      ]);

    await renderTranspose();

    await user.click(screen.getByRole("button", { name: /Transpose data/i }));

    expect(
      await screen.findByText(/Transposed 2 measure columns/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Transposed preview")).toBeInTheDocument();
  });
});
