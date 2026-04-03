import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import RegexTool from "@/components/data/regex-tool";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({ downloadFile: jest.fn() }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "email",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["ada@example.com", "grace@openai.com"],
  },
  {
    name: "score",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2, 3],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<RegexTool tableName="customers" columns={columns} />);
  });
}

function installRegexMocks() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("ROW_NUMBER() OVER ()")) {
      return [
        { row_number: 1, value: "ada@example.com" },
        { row_number: 2, value: "grace@openai.com" },
      ];
    }

    if (sql.includes("COUNT(*) AS cnt")) {
      return [{ cnt: 2 }];
    }

    return [];
  });
}

describe("RegexTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("tests a regex against the selected string column and shows extracted groups", async () => {
    installRegexMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Regex pattern"), {
        target: { value: "([a-z]+)@([a-z.]+)" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /test regex/i }));
    });

    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("Found 2 matching rows in email.")).toBeInTheDocument();
  });

  it("applies regex extraction back into DuckDB", async () => {
    installRegexMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Regex pattern"), {
        target: { value: "([a-z]+)@([a-z.]+)" },
      });
      fireEvent.click(screen.getByRole("button", { name: /test regex/i }));
    });

    await screen.findByText("Found 2 matching rows in email.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply extraction/i }));
    });

    expect(
      mockRunQuery.mock.calls.some(([sql]) => sql.includes("CREATE TABLE")),
    ).toBe(true);
    expect(
      mockRunQuery.mock.calls.some(([sql]) =>
        sql.includes('ALTER TABLE "customers" RENAME TO'),
      ),
    ).toBe(true);
    expect(await screen.findByText("Applied 2 extracted columns to customers.")).toBeInTheDocument();
  });

  it("exports the preview rows as CSV", async () => {
    installRegexMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Regex pattern"), {
        target: { value: "([a-z]+)@([a-z.]+)" },
      });
      fireEvent.click(screen.getByRole("button", { name: /test regex/i }));
    });

    await screen.findByText("Found 2 matching rows in email.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    });

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("row_number,value,matches,group_1,group_2"),
        "customers-regex-matches.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
