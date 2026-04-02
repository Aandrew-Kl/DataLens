import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataSampler from "@/components/data/data-sampler";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const samplerColumns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: [1, 2, 3],
    min: 1,
    max: 50,
    mean: 25.5,
    median: 25.5,
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B", "C"],
  },
  {
    name: "score",
    type: "number",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: [10, 20, 30],
    min: 10,
    max: 100,
    mean: 55,
    median: 55,
  },
];

describe("DataSampler", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockDownloadFile.mockReset();
  });

  it("renders the initial state, refreshes a random preview, and downloads the sample as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("sample_preview")) {
        return [
          { id: 1, category: "A", score: 10 },
          { id: 2, category: "B", score: 20 },
        ];
      }

      if (sql.includes("sample_count")) {
        return [{ cnt: 5 }];
      }

      if (sql === 'SELECT * FROM "orders" ORDER BY RANDOM() LIMIT 5') {
        return [
          { id: 1, category: "A", score: 10 },
          { id: 2, category: "B", score: 20 },
        ];
      }

      return [];
    });

    render(
      <DataSampler tableName="orders" columns={samplerColumns} rowCount={50} />,
    );

    expect(screen.getByText(/run the sampling query/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh preview/i }));

    expect(await screen.findByText("A")).toBeInTheDocument();
    expect(screen.getByText("Rows in sample")).toBeInTheDocument();
    expect(screen.getByText("Preview size")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /download csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      "id,category,score\n1,A,10\n2,B,20",
      "orders-random-sample.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("switches to top-n sampling and uses the chosen ranking column and count", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('ORDER BY "score" DESC NULLS LAST LIMIT 3') && sql.includes("sample_preview")) {
        return [{ id: 50, category: "C", score: 100 }];
      }

      if (sql.includes('ORDER BY "score" DESC NULLS LAST LIMIT 3') && sql.includes("sample_count")) {
        return [{ cnt: 3 }];
      }

      return [];
    });

    render(
      <DataSampler tableName="orders" columns={samplerColumns} rowCount={50} />,
    );

    await user.click(screen.getByRole("button", { name: /top n/i }));
    await user.selectOptions(screen.getAllByRole("combobox")[1], "score");

    const [countInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(countInput, { target: { value: "3" } });

    expect(
      screen.getByText("Returning the top 3 rows by score."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh preview/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY "score" DESC NULLS LAST LIMIT 3'),
      );
    });

    expect(await screen.findByText("100")).toBeInTheDocument();
  });

  it("shows query errors when preview generation fails", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Sampling query failed badly"));

    render(
      <DataSampler tableName="orders" columns={samplerColumns} rowCount={50} />,
    );

    await user.click(screen.getByRole("button", { name: /refresh preview/i }));

    expect(
      await screen.findByText("Sampling query failed badly"),
    ).toBeInTheDocument();
  });
});
