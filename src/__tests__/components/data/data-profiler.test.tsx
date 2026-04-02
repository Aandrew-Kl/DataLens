import { fireEvent, render, screen } from "@testing-library/react";

import DataProfiler from "@/components/data/data-profiler";
import type { ColumnProfile } from "@/types/dataset";

const mockColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 2,
    uniqueCount: 90,
    sampleValues: [10, 20, 30],
    min: 10,
    max: 300,
    mean: 120,
    median: 100,
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 10,
    uniqueCount: 80,
    sampleValues: ["2024-01-01", "2024-01-02"],
    min: "2024-01-01",
    max: "2024-02-01",
  },
];

describe("DataProfiler", () => {
  it("renders an empty state when there are no columns", () => {
    render(<DataProfiler columns={[]} rowCount={0} />);

    expect(screen.getByText("No column profiles available")).toBeInTheDocument();
  });

  it("renders the quality overview and column cards in grid mode", () => {
    const onColumnClick = jest.fn();

    render(
      <DataProfiler
        columns={mockColumns}
        rowCount={100}
        onColumnClick={onColumnClick}
      />,
    );

    expect(screen.getByText("Data Quality")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getAllByText("Samples")).toHaveLength(mockColumns.length);

    fireEvent.click(screen.getByText("amount"));
    expect(onColumnClick).toHaveBeenCalledWith(mockColumns[0]);
  });

  it("switches to list mode and keeps rows clickable", () => {
    const onColumnClick = jest.fn();

    render(
      <DataProfiler
        columns={mockColumns}
        rowCount={100}
        onColumnClick={onColumnClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /list/i }));

    expect(screen.getByRole("columnheader", { name: /column/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /complete/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText("region"));
    expect(onColumnClick).toHaveBeenCalledWith(mockColumns[1]);
  });
});
