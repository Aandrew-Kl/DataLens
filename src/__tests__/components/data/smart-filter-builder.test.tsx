import { act, render, screen } from "@testing-library/react";
import SmartFilterBuilder from "@/components/data/smart-filter-builder";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const columns: ColumnProfile[] = [
  { name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2, 3] },
  { name: "name", type: "string", nullCount: 1, uniqueCount: 8, sampleValues: ["a", "b"] },
  { name: "value", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1.5, 2.5] },
];

describe("SmartFilterBuilder", () => {
  it("renders without crashing", async () => {
    await act(async () => {
      render(<SmartFilterBuilder tableName="test_table" columns={columns} />);
    });
    expect(document.body.textContent).toBeTruthy();
  });

  it("displays the component heading", async () => {
    await act(async () => {
      render(<SmartFilterBuilder tableName="test_table" columns={columns} />);
    });
    // Find the main heading of the component
    const headings = screen.queryAllByRole("heading");
    const fallback = screen.queryAllByText(/component|tool|analyzer/i);
    expect(headings.length + fallback.length).toBeGreaterThan(0);
  });
});
