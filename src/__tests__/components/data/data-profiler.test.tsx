import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataProfiler from "@/components/data/data-profiler";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts", () => ({}));
jest.mock("echarts-for-react", () => jest.fn(() => null));

const columns: ColumnProfile[] = [
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
  it("renders columns from profile data", () => {
    render(<DataProfiler columns={columns} rowCount={100} />);

    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("region")).toBeInTheDocument();
    expect(screen.getByText("created_at")).toBeInTheDocument();
  });

  it("displays column names and type labels", () => {
    render(<DataProfiler columns={columns} rowCount={100} />);

    expect(screen.getByText("Number")).toBeInTheDocument();
    expect(screen.getByText("String")).toBeInTheDocument();
    expect(screen.getByText("Date")).toBeInTheDocument();
  });

  it("shows null and unique count stats", async () => {
    const user = userEvent.setup();
    render(<DataProfiler columns={columns} rowCount={100} />);

    await user.click(screen.getByRole("button", { name: /list/i }));

    await waitFor(() => {
      const amountRow = screen.getByRole("row", { name: /amount/i });
      const regionRow = screen.getByRole("row", { name: /region/i });
      const dateRow = screen.getByRole("row", { name: /created_at/i });

      expect(amountRow).toHaveTextContent("90");
      expect(amountRow).toHaveTextContent("2");
      expect(regionRow).toHaveTextContent("4");
      expect(regionRow).toHaveTextContent("0");
      expect(dateRow).toHaveTextContent("80");
      expect(dateRow).toHaveTextContent("10");
    });
  });
});
