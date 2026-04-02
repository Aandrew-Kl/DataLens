import { render, screen } from "@testing-library/react";

import DataSummary from "@/components/data/data-summary";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

jest.mock("framer-motion");

const dataset: DatasetMeta = {
  id: "sales",
  name: "sales",
  fileName: "sales.csv",
  rowCount: 100,
  columnCount: 4,
  uploadedAt: 1712102400000,
  sizeBytes: 4096,
  columns: [],
};

describe("DataSummary", () => {
  it("renders the dataset overview and quality issue cards", () => {
    const columns: ColumnProfile[] = [
      {
        name: "order_id",
        type: "number",
        nullCount: 0,
        uniqueCount: 100,
        sampleValues: [1, 2, 3],
      },
      {
        name: "region",
        type: "string",
        nullCount: 30,
        uniqueCount: 4,
        sampleValues: ["West", "East"],
      },
      {
        name: "status",
        type: "unknown",
        nullCount: 0,
        uniqueCount: 6,
        sampleValues: ["open", "closed"],
      },
      {
        name: "constant_value",
        type: "string",
        nullCount: 0,
        uniqueCount: 1,
        sampleValues: ["fixed"],
      },
    ];

    render(<DataSummary dataset={dataset} columns={columns} />);

    expect(
      screen.getByText(/Quick health readout for sales/i),
    ).toBeInTheDocument();
    expect(screen.getByText("92.5%")).toBeInTheDocument();
    expect(
      screen.getByText(/region is 30.0% null and may need cleanup/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/status could not be typed automatically/i),
    ).toBeInTheDocument();
  });

  it("shows a positive quality message when there are no issues", () => {
    const columns: ColumnProfile[] = [
      {
        name: "order_id",
        type: "number",
        nullCount: 0,
        uniqueCount: 100,
        sampleValues: [1, 2, 3],
      },
      {
        name: "created_at",
        type: "date",
        nullCount: 0,
        uniqueCount: 100,
        sampleValues: ["2025-01-01", "2025-01-02"],
      },
    ];

    render(<DataSummary dataset={{ ...dataset, columnCount: 2 }} columns={columns} />);

    expect(
      screen.getByText(/No major quality issues were detected/i),
    ).toBeInTheDocument();
  });
});
