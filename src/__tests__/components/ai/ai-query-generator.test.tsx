import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AIQueryGenerator from "@/components/ai/ai-query-generator";
import { generateSQL } from "@/lib/ai/sql-generator";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/ai/sql-generator", () => ({
  generateSQL: jest.fn(),
}));
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockGenerateSQL = jest.mocked(generateSQL);
const mockRunQuery = jest.mocked(runQuery);
const clipboardWriteText = jest.fn<Promise<void>, [string]>();

const columns: ColumnProfile[] = [
  {
    name: "month",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["2026-01-01", "2026-02-01"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 120,
    sampleValues: [100, 120],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AIQueryGenerator tableName="sales" columns={columns} />);
  });
}

describe("AIQueryGenerator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  it("renders the natural-language SQL generator", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Generate DuckDB SQL from natural language",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate SQL" })).toBeInTheDocument();
  });

  it("generates SQL and records history entries", async () => {
    const user = userEvent.setup();

    mockGenerateSQL.mockResolvedValue('SELECT "month", SUM("revenue") FROM "sales" GROUP BY 1;');

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Backend: ON" }));
    fireEvent.change(
      screen.getByPlaceholderText(/For example:/i),
      { target: { value: "Show monthly revenue" } },
    );

    await user.click(screen.getByRole("button", { name: "Generate SQL" }));

    expect(
      (await screen.findAllByText('SELECT "month", SUM("revenue") FROM "sales" GROUP BY 1;')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Show monthly revenue/i })).toBeInTheDocument();
    expect(screen.getByText("Generated SQL with Ollama.")).toBeInTheDocument();
  });

  it("copies and executes generated SQL", async () => {
    const user = userEvent.setup();

    mockGenerateSQL.mockResolvedValue('SELECT * FROM "sales" LIMIT 2;');
    mockRunQuery.mockResolvedValue([{ month: "2026-01-01" }, { month: "2026-02-01" }]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Backend: ON" }));
    fireEvent.change(
      screen.getByPlaceholderText(/For example:/i),
      { target: { value: "Give me two rows" } },
    );

    await user.click(screen.getByRole("button", { name: "Generate SQL" }));
    expect((await screen.findAllByText('SELECT * FROM "sales" LIMIT 2;')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Copy SQL" }));
    expect(await screen.findByText("Copied SQL to clipboard.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Execute SQL" }));
    expect(await screen.findByText("Executed SQL and returned 2 rows.")).toBeInTheDocument();
  });
});
