import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnTransformer from "@/components/data/column-transformer";
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
    uniqueCount: 12,
    sampleValues: [100, 120],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
];

describe("ColumnTransformer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([
      { revenue: 100, revenue_scaled: 0 },
      { revenue: 200, revenue_scaled: 1 },
    ]);
  });

  it("renders the transformation builder with empty-state guidance", () => {
    const user = userEvent.setup();

    render(<ColumnTransformer tableName="orders" columns={columns} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Build reusable DuckDB-backed transformation chains",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Transformation chain")).toBeInTheDocument();
    expect(screen.getByText("revenue_transformed")).toBeInTheDocument();

    void user;
  });

  it("queues a step and previews the generated pipeline", async () => {
    const user = userEvent.setup();

    render(<ColumnTransformer tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("New column name"), {
      target: { value: "revenue_scaled" },
    });

    await user.click(screen.getByRole("button", { name: "Add to chain" }));

    expect(
      screen.getByText("Queued revenue_scaled for preview and apply."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("revenue_scaled")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM "orders"'),
      );
    });

    expect(screen.getByText("Preview generated from DuckDB.")).toBeInTheDocument();
  });

  it("saves a recipe and reloads it from localStorage", async () => {
    const user = userEvent.setup();

    render(<ColumnTransformer tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("New column name"), {
      target: { value: "revenue_scaled" },
    });
    fireEvent.change(screen.getByPlaceholderText("Recipe name"), {
      target: { value: "Revenue cleanup" },
    });

    await user.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(screen.getByText("Saved recipe Revenue cleanup.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revenue cleanup/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("New column name"), {
      target: { value: "temporary_name" },
    });

    await user.click(screen.getByRole("button", { name: /Revenue cleanup/i }));

    expect(screen.getByText("Loaded recipe Revenue cleanup.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("revenue_scaled")).toBeInTheDocument();
  });

  it("applies a chain and can reject undo when there is no history", async () => {
    const user = userEvent.setup();

    render(<ColumnTransformer tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Undo last" }));

    expect(
      screen.getByText("There is no transformation to undo."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("New column name"), {
      target: { value: "revenue_scaled" },
    });
    await user.click(screen.getByRole("button", { name: "Apply chain" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('ALTER TABLE'),
      );
    });

    expect(
      screen.getByText("Transformation chain applied to the active DuckDB table."),
    ).toBeInTheDocument();
  });
});
