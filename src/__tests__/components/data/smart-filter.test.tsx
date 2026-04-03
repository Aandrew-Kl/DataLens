import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SmartFilter from "@/components/data/smart-filter";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
];

describe("SmartFilter", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockRunQuery.mockReset();
    mockRunQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("NTILE(8) OVER")) {
        return [
          { bucket: 1, min_value: 100, max_value: 200, bucket_count: 30 },
          { bucket: 2, min_value: 201, max_value: 300, bucket_count: 12 },
        ];
      }
      if (sql.includes('CAST("region" AS VARCHAR) AS label')) {
        return [{ label: "East", bucket_count: 22 }, { label: "West", bucket_count: 20 }];
      }
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 42 }];
      }
      return [];
    });
  });

  it("renders the filter builder and quick-filter stats", async () => {
    const user = userEvent.setup();

    render(<SmartFilter tableName="orders" columns={columns} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Natural language plus visual filter groups",
      }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /100.0 to 200.0/ })).toBeInTheDocument();
    });

    void user;
  });

  it("imports a parsed natural-language filter into the visual builder", async () => {
    const user = userEvent.setup();

    render(<SmartFilter tableName="orders" columns={columns} />);

    fireEvent.change(
      screen.getByPlaceholderText("revenue > 1000 AND region contains East"),
      { target: { value: "revenue > 100" } },
    );

    await user.click(screen.getByRole("button", { name: "Import parsed filters" }));

    expect(
      screen.getByText("Natural language filter imported into the builder."),
    ).toBeInTheDocument();
    expect(screen.getAllByText('"revenue" > 100')).toHaveLength(2);

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  it("surfaces parser errors for invalid expressions", async () => {
    const user = userEvent.setup();

    render(<SmartFilter tableName="orders" columns={columns} />);

    fireEvent.change(
      screen.getByPlaceholderText("revenue > 1000 AND region contains East"),
      { target: { value: "unknown > 10" } },
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Could not parse "unknown > 10"/),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Import parsed filters" }),
    ).toBeDisabled();

    void user;
  });

  it("adds a quick numeric filter from column stats", async () => {
    const user = userEvent.setup();

    render(<SmartFilter tableName="orders" columns={columns} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /100.0 to 200.0/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /100.0 to 200.0/ }));

    expect(
      screen.getByText("Quick filter added from 100.0 to 200.0."),
    ).toBeInTheDocument();
    expect(screen.getByText(/revenue between 100 and 200/i)).toBeInTheDocument();
  });

  it("saves and reloads a preset from localStorage", async () => {
    const user = userEvent.setup();

    render(<SmartFilter tableName="orders" columns={columns} />);

    fireEvent.change(
      screen.getByPlaceholderText("revenue > 1000 AND region contains East"),
      { target: { value: "revenue > 100" } },
    );
    await user.click(screen.getByRole("button", { name: "Save preset" }));

    expect(screen.getByText('Saved preset "revenue > 100".')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revenue > 100/i })).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("revenue > 1000 AND region contains East"),
      { target: { value: "" } },
    );
    await user.click(screen.getByRole("button", { name: /revenue > 100/i }));

    expect(screen.getByText('Loaded preset "revenue > 100".')).toBeInTheDocument();
    expect(screen.getByDisplayValue("revenue > 100")).toBeInTheDocument();
  });
});
