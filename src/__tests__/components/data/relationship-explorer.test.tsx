import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RelationshipExplorer from "@/components/data/relationship-explorer";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const idColumns: ColumnProfile[] = [
  {
    name: "id",
    type: "string",
    nullCount: 0,
    uniqueCount: 80,
    sampleValues: ["1", "2"],
  },
  {
    name: "customer_id",
    type: "string",
    nullCount: 5,
    uniqueCount: 75,
    sampleValues: ["1", "2"],
  },
  {
    name: "status",
    type: "string",
    nullCount: 2,
    uniqueCount: 4,
    sampleValues: ["open", "closed"],
  },
];

describe("RelationshipExplorer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders relationship details and reacts to graph clicks", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([
        {
          edge_id: "customer_id::id",
          shared_value_count: 70,
          left_max_frequency: 4,
          right_max_frequency: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          edge_id: "customer_id::id",
          determinant_name: "id",
          dependent_name: "customer_id",
          violating_groups: 0,
          determinant_groups: 10,
        },
      ]);

    render(
      <RelationshipExplorer
        tableName="orders"
        columns={idColumns}
        rowCount={100}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "id ↔ customer_id" }),
    ).toBeInTheDocument();
    expect(screen.getByText("many-to-one")).toBeInTheDocument();
    expect(screen.getByText("ID-style naming match")).toBeInTheDocument();

    await user.click(await screen.findByTestId("echarts-node-event"));

    expect(await screen.findByText("Selected Node")).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("Connections")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /id ↔ customer_id/i }));

    expect(
      await screen.findByRole("heading", { name: "id ↔ customer_id" }),
    ).toBeInTheDocument();
    expect(screen.getByText("id → customer_id")).toBeInTheDocument();
  });

  it("shows the empty-state copy when no strong relationships are detected", async () => {
    render(
      <RelationshipExplorer
        tableName="orders"
        columns={[
          {
            name: "status",
            type: "string",
            nullCount: 0,
            uniqueCount: 4,
            sampleValues: ["open", "closed"],
          },
          {
            name: "priority",
            type: "string",
            nullCount: 0,
            uniqueCount: 3,
            sampleValues: ["high", "low"],
          },
        ]}
        rowCount={40}
      />,
    );

    expect(
      await screen.findByText("No strong relationships detected"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Try adding more numeric columns or key-like fields/i),
    ).toBeInTheDocument();
  });

  it("surfaces discovery failures from DuckDB", async () => {
    mockRunQuery.mockRejectedValue(new Error("Relationship scan failed"));

    render(
      <RelationshipExplorer
        tableName="orders"
        columns={idColumns}
        rowCount={100}
      />,
    );

    expect(
      await screen.findByText("Relationship scan failed"),
    ).toBeInTheDocument();
  });
});
