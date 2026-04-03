import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SmartFilterBuilder from "@/components/data/smart-filter-builder";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [1, 2, 3],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["West", "East"],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<SmartFilterBuilder tableName="orders" columns={targetColumns} />);
  });
}

describe("SmartFilterBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when no columns are provided", async () => {
    await renderAsync([]);

    expect(
      screen.getByText("Filtering requires at least one profiled column."),
    ).toBeInTheDocument();
  });

  it("previews the matching row count and generates SQL", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ matching_rows: 2 }]);

    await renderAsync();

    await user.type(screen.getByLabelText("Group 1 row 1 value"), "7");
    await user.click(screen.getByRole("button", { name: "Preview count" }));

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
    expect(screen.getByTestId("smart-filter-sql")).toHaveTextContent('"id" = 7');
  });

  it("applies the filter and shows preview rows", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ id: 7, region: "West" }]);

    await renderAsync();

    await user.type(screen.getByLabelText("Group 1 row 1 value"), "7");
    await user.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(await screen.findByText("West")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
