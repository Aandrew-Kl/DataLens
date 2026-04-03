import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataPipeline from "@/components/data/data-pipeline";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

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

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200],
  },
];

function installPipelineQueryMocks() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("pipeline_count")) {
      return [{ cnt: 2 }];
    }
    if (sql.includes("pipeline_run")) {
      return [{ cnt: 2 }];
    }
    return [{ region: "East", sales: 100 }];
  });
}

describe("DataPipeline", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockDownloadFile.mockReset();
    window.localStorage.clear();
    installPipelineQueryMocks();
  });

  it("renders an empty builder and loads the live preview", async () => {
    render(<DataPipeline tableName="orders" columns={columns} />);

    expect(screen.getByText("No steps yet")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("East")).toBeInTheDocument();
      expect(screen.getByText('SELECT * FROM "orders"')).toBeInTheDocument();
    });
  });

  it("adds a filter step and recompiles the SQL", async () => {
    const user = userEvent.setup();

    render(<DataPipeline tableName="orders" columns={columns} />);
    void user;

    fireEvent.click(screen.getAllByRole("button", { name: /Filter/i })[0]);

    const valueInput = await screen.findByPlaceholderText("Value");
    fireEvent.change(valueInput, {
      target: { value: "East" },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("East")).toBeInTheDocument();
      expect(screen.getByDisplayValue(/WHERE "region" = 'East'/)).toBeInTheDocument();
    });
  });

  it("saves a pipeline and loads a stored snapshot", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:pipelines:orders",
      JSON.stringify([
        {
          id: "saved-1",
          name: "Saved sort",
          savedAt: 1,
          steps: [
            {
              id: "step-1",
              type: "sort",
              column: "region",
              operator: "=",
              value: "",
              direction: "DESC",
              columns: ["region"],
              groupColumns: ["region"],
              aggregateFunction: "COUNT",
              aggregateColumn: "sales",
              aggregateAlias: "metric_value",
              joinTable: "",
              joinType: "LEFT",
              leftColumn: "region",
              rightColumn: "region",
              rightColumns: "region",
              newName: "region_new",
              newType: "DOUBLE",
              expression: "",
              sampleMode: "rows",
              sampleSize: 100,
            },
          ],
        },
      ]),
    );

    render(<DataPipeline tableName="orders" columns={columns} />);
    void user;

    await waitFor(() => {
      expect(screen.getByText("Saved sort")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    await waitFor(() => {
      expect(
        screen.getByDisplayValue(/ORDER BY "region" DESC NULLS LAST/),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Pipeline name"), {
      target: { value: "Ad hoc flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText('Saved "Ad hoc flow" to localStorage.'),
      ).toBeInTheDocument();
    });

    const savedPipelines = JSON.parse(
      window.localStorage.getItem("datalens:pipelines:orders") ?? "[]",
    ) as Array<{ name: string }>;

    expect(savedPipelines[0]?.name).toBe("Ad hoc flow");
  });

  it("exports the compiled SQL", async () => {
    const user = userEvent.setup();

    render(<DataPipeline tableName="orders" columns={columns} />);
    void user;

    await waitFor(() => {
      expect(screen.getByDisplayValue('SELECT * FROM "orders"')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export SQL" }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledTimes(1);
      expect(mockDownloadFile).toHaveBeenLastCalledWith(
        expect.stringContaining('SELECT * FROM "orders"'),
        "orders-pipeline.sql",
        "text/sql;charset=utf-8;",
      );
    });
  });

  it("runs the pipeline and reports the output row count", async () => {
    const user = userEvent.setup();

    render(<DataPipeline tableName="orders" columns={columns} />);
    void user;

    await waitFor(() => {
      expect(screen.getByText("East")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Run pipeline" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Pipeline executed successfully\. Final result contains 2 rows\./),
      ).toBeInTheDocument();
    });
  });
});
