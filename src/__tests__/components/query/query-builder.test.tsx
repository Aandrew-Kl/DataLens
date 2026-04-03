import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QueryBuilder from "@/components/query/query-builder";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200],
  },
  {
    name: "active",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

describe("QueryBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("builds SQL from the selected columns and emits the generated query", async () => {
    const user = userEvent.setup();
    const onQueryGenerated = jest.fn();

    const { container } = render(
      <QueryBuilder
        tableName="sales"
        columns={columns}
        onQueryGenerated={onQueryGenerated}
      />,
    );

    await user.click(screen.getByLabelText(/region/i));
    await user.click(screen.getByLabelText(/revenue/i));

    const aggregateSelects = screen.getAllByDisplayValue("NONE");
    await user.selectOptions(aggregateSelects[1]!, "SUM");

    await user.click(screen.getByRole("button", { name: /add filter/i }));
    fireEvent.change(screen.getByPlaceholderText("Value"), {
      target: { value: "East" },
    });

    await user.click(screen.getByRole("button", { name: /add sort rule/i }));

    const sqlPreview = container.querySelector("code");

    expect(sqlPreview).not.toBeNull();
    expect(sqlPreview).toHaveTextContent(
      /SELECT "region",\s+SUM\("revenue"\) AS "sum_revenue"/i,
    );
    expect(sqlPreview).toHaveTextContent(/WHERE "region" = 'East'/i);
    expect(sqlPreview).toHaveTextContent(/GROUP BY "region"/i);
    expect(sqlPreview).toHaveTextContent(/ORDER BY "region" ASC/i);
    expect(sqlPreview).toHaveTextContent(/LIMIT 1000;/i);

    await user.click(screen.getByRole("button", { name: /run query/i }));

    expect(onQueryGenerated).toHaveBeenCalledWith(
      expect.stringContaining('FROM "sales"'),
    );
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("copies the generated SQL to the clipboard", async () => {
    const user = userEvent.setup();

    render(
      <QueryBuilder
        tableName="sales"
        columns={columns}
        onQueryGenerated={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy sql/i }));

    expect(
      await screen.findByRole("button", { name: /copied/i }),
    ).toBeInTheDocument();
  });

  it("supports null-aware filters and shows empty states for optional sections", async () => {
    const user = userEvent.setup();

    render(
      <QueryBuilder
        tableName="sales"
        columns={columns}
        onQueryGenerated={jest.fn()}
      />,
    );

    expect(screen.getByText("No WHERE filters yet.")).toBeInTheDocument();
    expect(screen.getByText("No HAVING clauses yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/Results will keep DuckDB's default ordering\./i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add filter/i }));
    await user.selectOptions(screen.getAllByDisplayValue("=")[0]!, "IS NULL");

    const valueInput = screen.getByPlaceholderText("Value");
    expect(valueInput).toBeDisabled();
    expect(screen.getByText(/WHERE "region" IS NULL/i)).toBeInTheDocument();
  });
});
