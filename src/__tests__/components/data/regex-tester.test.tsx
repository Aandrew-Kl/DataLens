import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RegexTester from "@/components/data/regex-tester";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const textColumns: ColumnProfile[] = [
  {
    name: "email",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["a@example.com", "b@example.com"],
  },
];

describe("RegexTester", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the empty guard when the dataset has no text columns", () => {
    render(
      <RegexTester
        tableName="metrics"
        columns={[
          {
            name: "amount",
            type: "number",
            nullCount: 0,
            uniqueCount: 10,
            sampleValues: [1, 2],
          },
        ]}
      />,
    );

    expect(screen.getByText("No text columns available")).toBeInTheDocument();
    expect(
      screen.getByText(/This tool needs a string-like column in metrics/i),
    ).toBeInTheDocument();
  });

  it("tests a valid regex and renders matching rows", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS cnt")) {
        return [{ cnt: 2 }];
      }

      return [
        { row_number: 1, cell_value: "alice@example.com" },
        { row_number: 4, cell_value: "ops@example.com" },
      ];
    });

    render(<RegexTester tableName="customers" columns={textColumns} />);

    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.click(screen.getByRole("button", { name: /test regex/i }));

    expect(
      await screen.findByText(/Previewed 2 rows for email\./i),
    ).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows regex validation errors and disables execution buttons", async () => {
    const user = userEvent.setup();

    render(<RegexTester tableName="customers" columns={textColumns} />);

    await user.type(screen.getByPlaceholderText("^(ERROR|WARN)"), "(");

    expect(screen.getByText("Regex error")).toBeInTheDocument();
    expect(screen.getByText(/unterminated group/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test regex/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /filter data/i })).toBeDisabled();
  });

  it("surfaces DuckDB failures when testing the regex", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Regex engine exploded"));

    render(<RegexTester tableName="customers" columns={textColumns} />);

    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.click(screen.getByRole("button", { name: /test regex/i }));

    await waitFor(() => {
      expect(screen.getByText("Regex engine exploded")).toBeInTheDocument();
    });
  });
});
