import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataPipelineBuilder from "@/components/data/data-pipeline-builder";
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
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [10, 20],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<DataPipelineBuilder tableName="orders" columns={columns} />);
  });
}

describe("DataPipelineBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the pipeline builder shell and add-step controls", async () => {
    await renderComponent();

    expect(
      screen.getByText("Chain transforms, preview each stage, and export the full pipeline"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aggregate/i })).toBeInTheDocument();
  });

  it("previews a pipeline stage and executes the final output", async () => {
    const user = userEvent.setup();
    mockRunQuery
      .mockResolvedValueOnce([{ region: "East", sales: 10 }])
      .mockResolvedValueOnce([{ row_count: 1 }])
      .mockResolvedValueOnce([{ region: "East", sales: 10 }])
      .mockResolvedValueOnce([{ row_count: 1 }]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /^Filter$/i }));
    await user.click(screen.getByRole("button", { name: /Preview stages/i }));

    expect(await screen.findByText("Step preview")).toBeInTheDocument();
    expect(screen.getAllByText("East").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: /Execute full pipeline/i }));
    expect(mockRunQuery).toHaveBeenCalled();
  });

  it("exports the pipeline definition as JSON", async () => {
    const user = userEvent.setup();

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /^Map$/i }));
    await user.click(screen.getByRole("button", { name: /Export pipeline JSON/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining('"tableName": "orders"'),
      "orders-pipeline.json",
      "application/json;charset=utf-8;",
    );
  });
});
