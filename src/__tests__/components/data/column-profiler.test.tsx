import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColumnProfiler from "@/components/data/column-profiler";
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
    name: "email",
    type: "string",
    nullCount: 2,
    uniqueCount: 8,
    sampleValues: ["a@example.com", "b@example.com"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ColumnProfiler tableName="orders" columns={columns} />);
  });
}

describe("ColumnProfiler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the profiler controls", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Deep profile a single column",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Profile column" })).toBeInTheDocument();
  });

  it("profiles a column and displays pattern analysis", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([
        {
          row_count: 10,
          non_null_count: 8,
          unique_count: 8,
          min_value: "a@example.com",
          max_value: "z@example.com",
          avg_length: 13,
          min_length: 11,
          max_length: 15,
          numeric_average: 0,
        },
      ])
      .mockResolvedValueOnce([{ value: "a@example.com", frequency: 2 }])
      .mockResolvedValueOnce([{ value: "a@example.com" }, { value: "b@example.com" }])
      .mockResolvedValueOnce([{ pattern: "email-like", frequency: 8 }]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Profile column" }));

    expect((await screen.findAllByText("80.0%")).length).toBeGreaterThan(0);
    expect(screen.getByText("email-like • 8")).toBeInTheDocument();
    expect(screen.getByText("a@example.com • 2")).toBeInTheDocument();
  });

  it("exports the profile report as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([
        {
          row_count: 10,
          non_null_count: 8,
          unique_count: 8,
          min_value: "a@example.com",
          max_value: "z@example.com",
          avg_length: 13,
          min_length: 11,
          max_length: 15,
          numeric_average: 0,
        },
      ])
      .mockResolvedValueOnce([{ value: "a@example.com", frequency: 2 }])
      .mockResolvedValueOnce([{ value: "a@example.com" }])
      .mockResolvedValueOnce([{ pattern: "email-like", frequency: 8 }]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Profile column" }));
    expect((await screen.findAllByText("80.0%")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Export report" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("column,email"),
      "orders-email-profile.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
