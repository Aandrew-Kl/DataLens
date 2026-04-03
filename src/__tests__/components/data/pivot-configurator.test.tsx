import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PivotConfigurator from "@/components/data/pivot-configurator";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 20],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "quarter",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Q1", "Q2"],
  },
];

function getDropZone(subtitle: string) {
  const zone = screen.getByText(subtitle).parentElement;
  expect(zone).not.toBeNull();
  return zone as HTMLElement;
}

function seedSavedLayout() {
  window.localStorage.setItem(
    "datalens:pivot-configurator:sales",
    JSON.stringify([
      {
        id: "saved-layout",
        name: "Saved layout",
        rowFields: ["region"],
        columnFields: [],
        valueFields: [
          {
            id: "value-sales",
            column: "sales",
            aggregation: "COUNT",
            alias: "count_sales",
          },
        ],
        filters: [],
        calculatedFields: [],
        conditionalRules: [],
        showSubtotals: true,
        showGrandTotals: true,
      },
    ]),
  );
}

async function renderConfigurator() {
  await act(async () => {
    render(<PivotConfigurator tableName="sales" columns={columns} />);
  });
}

async function loadSavedLayout() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Load" }));
  expect(await screen.findByText('Loaded "Saved layout".')).toBeInTheDocument();
}

describe("PivotConfigurator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("requires a row or column dimension before running the pivot", async () => {
    await renderConfigurator();

    await userEvent.setup().click(screen.getByRole("button", { name: /run pivot/i }));

    expect(
      await screen.findByText("Drag at least one field into rows or columns."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("runs the pivot and renders grouped results in the table", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { region: "East", count_sales: 2 },
      { region: "West", count_sales: 3 },
    ]);

    seedSavedLayout();
    await renderConfigurator();
    await loadSavedLayout();

    const rowsZone = getDropZone("Drop dimensions that should define row groups.");
    expect(within(rowsZone).getByText("region")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /run pivot/i }));

    expect(await screen.findByText("Pivot returned 2 grouped rows.")).toBeInTheDocument();
    expect(screen.getByText("East")).toBeInTheDocument();
    expect(screen.getByText("West")).toBeInTheDocument();
    expect(screen.getByText("Grand total")).toBeInTheDocument();
  });

  it("saves the current layout to localStorage", async () => {
    const user = userEvent.setup();

    seedSavedLayout();
    await renderConfigurator();
    await loadSavedLayout();

    fireEvent.change(
      screen.getByPlaceholderText("Quarterly executive pivot"),
      { target: { value: "Quarterly sales" } },
    );
    await user.click(screen.getByRole("button", { name: /save layout/i }));

    expect(
      await screen.findByText('Saved "Quarterly sales" to localStorage.'),
    ).toBeInTheDocument();
    expect(
      window.localStorage.getItem("datalens:pivot-configurator:sales"),
    ).toContain("Quarterly sales");
  });

  it("exports the rendered pivot as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { region: "East", count_sales: 2 },
      { region: "West", count_sales: 3 },
    ]);

    seedSavedLayout();
    await renderConfigurator();
    await loadSavedLayout();

    await user.click(screen.getByRole("button", { name: /run pivot/i }));
    await screen.findByText("Pivot returned 2 grouped rows.");

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Grand total"),
      "sales-pivot-configured.csv",
      "text/csv;charset=utf-8",
    );
  });

  it("shows query failures in the notice banner", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Pivot query failed hard"));

    seedSavedLayout();
    await renderConfigurator();
    await loadSavedLayout();

    await user.click(screen.getByRole("button", { name: /run pivot/i }));

    expect(await screen.findByText("Pivot query failed hard")).toBeInTheDocument();
  });
});
