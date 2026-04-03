import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataConnector from "@/components/data/data-connector";
import { loadCSVIntoDB, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  initDuckDB: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock("@/lib/duckdb/profiler", () => ({
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

const mockRunQuery = jest.mocked(runQuery);
const mockLoadCSVIntoDB = jest.mocked(loadCSVIntoDB);
const mockProfileTable = jest.mocked(profileTable);

const profiledColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [100, 120],
  },
];

describe("DataConnector", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockLoadCSVIntoDB.mockReset();
    mockProfileTable.mockReset();
    mockRunQuery.mockResolvedValue([
      { region: "East", revenue: 100 },
      { region: "West", revenue: 120 },
    ]);
    mockProfileTable.mockResolvedValue(profiledColumns);
    window.fetch = jest.fn();
  });

  it("renders the connector tabs and initial status", () => {
    const user = userEvent.setup();

    render(<DataConnector onDataLoaded={jest.fn()} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Import data from files, URLs, pasted text, or bundled samples",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ready to import data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sample Datasets" })).toBeInTheDocument();

    void user;
  });

  it("loads a bundled sample dataset and notifies the parent", async () => {
    const user = userEvent.setup();
    const onDataLoaded = jest.fn();

    render(<DataConnector onDataLoaded={onDataLoaded} />);

    await user.click(screen.getByRole("button", { name: "Sample Datasets" }));
    await user.click(screen.getByRole("button", { name: /Iris/i }));

    await waitFor(() => {
      expect(mockLoadCSVIntoDB).toHaveBeenCalledWith(
        "iris",
        expect.stringContaining("sepal_length"),
      );
    });

    expect(screen.getByText("Loaded iris into DuckDB.")).toBeInTheDocument();
    expect(onDataLoaded).toHaveBeenCalledWith({
      tableName: "iris",
      columns: profiledColumns,
    });
  });

  it("validates empty pasted input", async () => {
    const user = userEvent.setup();

    render(<DataConnector onDataLoaded={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Paste Data" }));
    await user.click(screen.getByRole("button", { name: "Import pasted data" }));

    expect(
      screen.getByText("Paste CSV or TSV content before importing."),
    ).toBeInTheDocument();
  });

  it("imports pasted TSV content as a CSV-backed table", async () => {
    const user = userEvent.setup();
    const onDataLoaded = jest.fn();

    render(<DataConnector onDataLoaded={onDataLoaded} />);

    await user.click(screen.getByRole("button", { name: "Paste Data" }));
    fireEvent.change(screen.getByPlaceholderText("Paste CSV or TSV rows here"), {
      target: { value: "region\trevenue\nEast\t100\nWest\t120" },
    });
    await user.click(screen.getByRole("button", { name: "Import pasted data" }));

    await waitFor(() => {
      expect(mockLoadCSVIntoDB).toHaveBeenCalledWith(
        expect.stringMatching(/^pasted_data_/),
        "region,revenue\nEast,100\nWest,120",
      );
    });

    expect(onDataLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: expect.stringMatching(/^pasted_data_/),
        columns: profiledColumns,
      }),
    );
  });

  it("imports a remote CSV URL", async () => {
    const user = userEvent.setup();
    const onDataLoaded = jest.fn();

    (window.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/csv" }),
      text: jest.fn().mockResolvedValue("region,revenue\nEast,100"),
    } as unknown as Response);

    render(<DataConnector onDataLoaded={onDataLoaded} />);

    await user.click(screen.getByRole("button", { name: "URL Import" }));
    fireEvent.change(screen.getByPlaceholderText("https://example.com/data.csv"), {
      target: { value: "https://example.com/orders.csv" },
    });
    await user.click(screen.getByRole("button", { name: "Import from URL" }));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith("https://example.com/orders.csv");
      expect(mockLoadCSVIntoDB).toHaveBeenCalledWith(
        "orders",
        "region,revenue\nEast,100",
      );
    });

    expect(onDataLoaded).toHaveBeenCalled();
  });
});
