import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Crosstab from "@/components/data/crosstab";
import { runQuery } from "@/lib/duckdb/client";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

describe("Crosstab", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("requires two eligible low-cardinality columns", () => {
    render(
      <Crosstab
        tableName="orders"
        columns={[
          {
            name: "id",
            type: "number",
            nullCount: 0,
            uniqueCount: 100,
            sampleValues: [1, 2],
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/Cross tab needs at least two low-cardinality columns/i),
    ).toBeInTheDocument();
  });

  it("renders the contingency table and switches to row percentages", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([{ label: "East" }, { label: "West" }])
      .mockResolvedValueOnce([{ label: "Online" }, { label: "Retail" }])
      .mockResolvedValueOnce([
        { row_key: "East", pivot_0: 2, pivot_1: 1, __row_total__: 3 },
        { row_key: "West", pivot_0: 1, pivot_1: 2, __row_total__: 3 },
      ]);

    render(
      <Crosstab
        tableName="orders"
        columns={[
          {
            name: "region",
            type: "string",
            nullCount: 0,
            uniqueCount: 2,
            sampleValues: ["East", "West"],
          },
          {
            name: "channel",
            type: "string",
            nullCount: 0,
            uniqueCount: 2,
            sampleValues: ["Online", "Retail"],
          },
        ]}
      />,
    );

    expect(await screen.findByText("region by channel")).toBeInTheDocument();
    expect(await screen.findByText("Cramér's V = 0.33")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Row %/i }));

    await waitFor(() => {
      expect(screen.getAllByText("66.7%").length).toBeGreaterThan(0);
    });
  });

  it("shows the query error when the pivot cannot be built", async () => {
    mockRunQuery.mockRejectedValue(new Error("Crosstab failed"));

    render(
      <Crosstab
        tableName="orders"
        columns={[
          {
            name: "region",
            type: "string",
            nullCount: 0,
            uniqueCount: 2,
            sampleValues: ["East", "West"],
          },
          {
            name: "channel",
            type: "string",
            nullCount: 0,
            uniqueCount: 2,
            sampleValues: ["Online", "Retail"],
          },
        ]}
      />,
    );

    expect(await screen.findByText("Crosstab failed")).toBeInTheDocument();
  });
});
