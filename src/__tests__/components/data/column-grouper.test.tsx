import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnGrouper from "@/components/data/column-grouper";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
    ) => {
      const [value, setValue] = actual.useState(getSnapshot);
      actual.useEffect(() => subscribe(() => setValue(getSnapshot())), [subscribe, getSnapshot]);
      return value;
    },
  };
});

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

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
    uniqueCount: 24,
    sampleValues: [100, 200],
  },
  {
    name: "cost",
    type: "number",
    nullCount: 0,
    uniqueCount: 18,
    sampleValues: [40, 80],
  },
];

describe("ColumnGrouper", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([]);
    window.localStorage.clear();
  });

  it("requires a group name before saving", async () => {
    const user = userEvent.setup();

    render(<ColumnGrouper tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(screen.getByText("Group name is required.")).toBeInTheDocument();
  });

  it("creates a group and assigns selected columns", async () => {
    const user = userEvent.setup();

    render(<ColumnGrouper tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("Financial Columns"), {
      target: { value: "Finance" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Metrics used in revenue and margin analysis"),
      { target: { value: "Core margin inputs" } },
    );

    await user.click(screen.getByRole("button", { name: "Create group" }));

    await waitFor(() => {
      expect(screen.getByText('Created "Finance".')).toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: /revenue/ }));
    await user.click(screen.getByRole("checkbox", { name: /cost/ }));
    await user.click(screen.getByRole("button", { name: "Add selected" }));

    await waitFor(() => {
      expect(screen.getByText("Added 2 columns.")).toBeInTheDocument();
    });

    const storedState = JSON.parse(
      window.localStorage.getItem("datalens:column-grouper:orders") ?? "{}",
    ) as {
      groups: Array<{ name: string; columnNames: string[] }>;
      computedColumns: Array<Record<string, unknown>>;
    };

    expect(storedState.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Finance",
          columnNames: ["cost", "revenue"],
        }),
      ]),
    );
  });

  it("previews a computed column through DuckDB", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValueOnce([{ gross_margin_pct: 0.45 }]);

    render(<ColumnGrouper tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("gross_margin_pct"), {
      target: { value: "gross_margin_pct" },
    });
    fireEvent.change(
      screen.getByPlaceholderText('("revenue" - "cost") / NULLIF("revenue", 0)'),
      { target: { value: '("revenue" - "cost") / NULLIF("revenue", 0)' } },
    );

    await user.click(screen.getByRole("button", { name: "Preview in DuckDB" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT ("revenue" - "cost") / NULLIF("revenue", 0) AS "gross_margin_pct"'),
      );
      expect(screen.getByText("Preview generated from DuckDB.")).toBeInTheDocument();
      expect(screen.getByText("0.45")).toBeInTheDocument();
    });
  });

  it("saves a computed column and dispatches a creation event", async () => {
    const user = userEvent.setup();
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    render(<ColumnGrouper tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("gross_margin_pct"), {
      target: { value: "gross_margin_pct" },
    });
    fireEvent.change(
      screen.getByPlaceholderText('("revenue" - "cost") / NULLIF("revenue", 0)'),
      { target: { value: '("revenue" - "cost") / NULLIF("revenue", 0)' } },
    );

    await user.click(screen.getByRole("button", { name: "Save computed column" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE OR REPLACE TABLE "orders" AS SELECT *, ("revenue" - "cost") / NULLIF("revenue", 0) AS "gross_margin_pct"'),
      );
      expect(
        screen.getByText('Materialized computed column "gross_margin_pct" in DuckDB.'),
      ).toBeInTheDocument();
    });

    const storedState = JSON.parse(
      window.localStorage.getItem("datalens:column-grouper:orders") ?? "{}",
    ) as {
      groups: Array<Record<string, unknown>>;
      computedColumns: Array<{ name: string; expression: string }>;
    };

    expect(storedState.computedColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "gross_margin_pct",
          expression: '("revenue" - "cost") / NULLIF("revenue", 0)',
        }),
      ]),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "datalens:computed-column-created",
      }),
    );
  });

  it("removes a stored computed column definition", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:column-grouper:orders",
      JSON.stringify({
        groups: [],
        computedColumns: [
          {
            id: "computed-1",
            name: "gross_margin_pct",
            expression: '("revenue" - "cost") / NULLIF("revenue", 0)',
            createdAt: 1,
          },
        ],
      }),
    );

    render(<ColumnGrouper tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Remove definition" }));

    await waitFor(() => {
      expect(
        screen.getByText("Computed column definition removed from localStorage."),
      ).toBeInTheDocument();
    });

    const storedState = JSON.parse(
      window.localStorage.getItem("datalens:column-grouper:orders") ?? "{}",
    ) as { computedColumns: Array<Record<string, unknown>> };

    expect(storedState.computedColumns).toHaveLength(0);
  });
});
