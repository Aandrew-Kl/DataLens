import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataRecipeBuilder from "@/components/data/data-recipe-builder";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<DataRecipeBuilder tableName="orders" columns={columns} />);
  });
}

describe("DataRecipeBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders the recipe builder shell", async () => {
    await renderComponent();

    expect(
      screen.getByText("Build reusable transformation recipes for any table"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save recipe/i })).toBeInTheDocument();
  });

  it("saves a recipe to localStorage", async () => {
    const user = userEvent.setup();

    await renderComponent();
    fireEvent.change(screen.getByLabelText("Recipe name"), {
      target: { value: "Top regions" },
    });
    await user.click(screen.getByRole("button", { name: /^Filter$/i }));
    await user.click(screen.getByRole("button", { name: /Save recipe/i }));

    expect(window.localStorage.getItem("datalens:data-recipes")).toContain("Top regions");
    expect(screen.getByText(/Saved "Top regions" to localStorage./i)).toBeInTheDocument();
  });

  it("imports recipe JSON and applies a recipe preview", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ region: "East", sales: 10 }]);

    await renderComponent();
    const importInput = screen.getByLabelText("Recipe import JSON");
    fireEvent.change(importInput, {
      target: { value: '[{"id":"r1","name":"Imported recipe","description":"demo","steps":[],"savedAt":1}]' },
    });
    await user.click(screen.getByRole("button", { name: /Import JSON/i }));
    expect(await screen.findByText("Imported recipe")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^Apply$/i })[0]);
    expect(await screen.findByText("East")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalled();
  });
});
