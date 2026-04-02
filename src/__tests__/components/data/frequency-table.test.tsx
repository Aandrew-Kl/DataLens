import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FrequencyTable from "@/components/data/frequency-table";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react", () => {

  function MockChart(props: {
    option?: {
      xAxis?: {
        data?: string[];
      };
    };
  }) {
    return React.createElement(
      "div",
      { "data-testid": "echarts-mock" },
      JSON.stringify(props.option?.xAxis?.data ?? []),
    );
  }

  return {
    __esModule: true,
    default: MockChart,
  };
});

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const categoricalColumns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["active", "inactive", "archived"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 16,
    sampleValues: [1, 2, 3],
    min: 1,
    max: 16,
    mean: 8.5,
    median: 8.5,
  },
];

const numericColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 16,
    sampleValues: [1, 2, 3],
    min: 1,
    max: 16,
    mean: 8.5,
    median: 8.5,
  },
];

function getTableValueOrder(): string[] {
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row");

  return rows.slice(1).map((row) => {
    const [firstCell] = within(row).getAllByRole("cell");
    return firstCell?.textContent ?? "";
  });
}

describe("FrequencyTable", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders an empty state when there are no columns", () => {
    render(<FrequencyTable tableName="orders" columns={[]} />);

    expect(
      screen.getByText("No columns available for frequency analysis."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders categorical frequencies and supports sorting and search", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('CAST("status" AS VARCHAR) AS bucket_label')) {
        return [
          { bucket_label: "active", count: 5 },
          { bucket_label: "inactive", count: 2 },
          { bucket_label: "archived", count: 1 },
        ];
      }

      return [];
    });

    render(<FrequencyTable tableName="orders" columns={categoricalColumns} />);

    expect(await screen.findByText("active")).toBeInTheDocument();
    expect(getTableValueOrder()).toEqual(["active", "inactive", "archived"]);

    await user.click(screen.getByRole("button", { name: /desc/i }));

    expect(getTableValueOrder()).toEqual(["archived", "inactive", "active"]);

    await user.clear(screen.getByPlaceholderText("Search values or bins"));
    await user.type(screen.getByPlaceholderText("Search values or bins"), "zzz");

    expect(await screen.findByText("No matching values.")).toBeInTheDocument();
    expect(
      screen.getByText("Adjust the search, bins, or selected column."),
    ).toBeInTheDocument();
  });

  it("renders numeric histograms and reloads data when the custom bin count changes", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      const match = sql.match(/range\(0, (\d+)\)/);
      const binCount = Number(match?.[1] ?? 6);

      return Array.from({ length: binCount }, (_, index) => ({
        bin_index: index,
        start_value: index,
        end_value: index + 1,
        count: index + 1,
      }));
    });

    render(<FrequencyTable tableName="orders" columns={numericColumns} />);

    expect(await screen.findByText("Histogram")).toBeInTheDocument();
    expect(screen.getByTestId("echarts-mock")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining("range(0, 6)"),
      );
    });

    await user.click(screen.getByRole("button", { name: /^custom$/i }));

    const binInput = screen.getByRole("spinbutton");
    fireEvent.change(binInput, { target: { value: "4" } });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining("range(0, 4)"),
      );
    });

    expect(screen.getByText("0 – 1")).toBeInTheDocument();
    expect(screen.getByText("3 – 4")).toBeInTheDocument();
  });
});
