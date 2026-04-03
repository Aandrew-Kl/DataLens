import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataQualityRules from "@/components/data/data-quality-rules";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockExportToCSV = exportToCSV as jest.MockedFunction<typeof exportToCSV>;

const columns: ColumnProfile[] = [
  {
    name: "email",
    type: "string",
    nullCount: 1,
    uniqueCount: 8,
    sampleValues: ["a@example.com", "b@example.com"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 7,
    sampleValues: [10, 20],
    min: 0,
    max: 100,
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 7,
    sampleValues: ["2026-01-01", "2026-01-02"],
    min: "2026-01-01",
    max: "2026-01-31",
  },
];

describe("DataQualityRules", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([]);
    mockExportToCSV.mockReset();
    window.localStorage.clear();
  });

  it("renders the rule builder with empty saved and result states", () => {
    render(<DataQualityRules tableName="orders" columns={columns} />);

    expect(
      screen.getByText("Define quality checks for orders"),
    ).toBeInTheDocument();
    expect(screen.getByText("No saved rule sets yet.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Run the rule engine to see violations, compliance, and sampled failure rows.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Export violations CSV/i }),
    ).toBeDisabled();
  });

  it("applies presets and saves a reusable rule set", async () => {
    const user = userEvent.setup();

    render(<DataQualityRules tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Positive numbers/i }));

    expect(screen.getAllByRole("button", { name: /Remove/i })).toHaveLength(2);
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Rule set name"), {
      target: { value: "Core checks" },
    });
    await user.click(screen.getByRole("button", { name: /Save set/i }));

    expect(
      JSON.parse(
        window.localStorage.getItem("datalens:data-quality-rules:orders") ?? "[]",
      ),
    ).toEqual([
      expect.objectContaining({
        name: "Core checks",
        rules: expect.arrayContaining([
          expect.objectContaining({ leftColumn: "email" }),
          expect.objectContaining({ leftColumn: "amount", value: "0" }),
        ]),
      }),
    ]);
  });

  it("loads saved rule sets from localStorage", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:data-quality-rules:orders",
      JSON.stringify([
        {
          id: "saved-1",
          name: "Saved checks",
          savedAt: Date.UTC(2026, 0, 2),
          rules: [
            {
              id: "rule-1",
              leftColumn: "email",
              operator: "regex",
              operandMode: "value",
              rightColumn: "amount",
              value: "@example.com$",
              secondaryValue: "",
            },
            {
              id: "rule-2",
              leftColumn: "amount",
              operator: "gt",
              operandMode: "value",
              rightColumn: "email",
              value: "0",
              secondaryValue: "",
            },
          ],
        },
      ]),
    );

    render(<DataQualityRules tableName="orders" columns={columns} />);

    expect(await screen.findByText("Saved checks")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Load/i }));

    expect(screen.getAllByRole("button", { name: /Remove/i })).toHaveLength(2);
    expect(screen.getByDisplayValue("@example.com$")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();
  });

  it("runs the configured rules and renders violation samples", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("AS row_count")) {
        return [{ row_count: 10 }];
      }
      if (sql.includes("AS violations")) {
        return [{ violations: 2 }];
      }
      if (sql.includes("LIMIT 8")) {
        return [
          { email: null, amount: 100, created_at: "2026-01-04" },
          { email: null, amount: 40, created_at: "2026-01-05" },
        ];
      }
      return [];
    });

    render(<DataQualityRules tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Run all rules/i }));

    expect(await screen.findByText("email not null")).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("2 violations")).toBeInTheDocument();
    expect(screen.getAllByText("null").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-01-04")).toBeInTheDocument();
  });

  it("exports failing rows after the engine finishes", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("AS row_count")) {
        return [{ row_count: 10 }];
      }
      if (sql.includes("AS violations")) {
        return [{ violations: 2 }];
      }
      if (sql.includes("LIMIT 8")) {
        return [{ email: null, amount: 100, created_at: "2026-01-04" }];
      }
      if (sql.includes('SELECT * FROM "orders" WHERE "email" IS NULL')) {
        return [{ email: null, amount: 100, created_at: "2026-01-04" }];
      }
      return [];
    });

    render(<DataQualityRules tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Run all rules/i }));
    await screen.findByText("email not null");

    const exportButton = screen.getByRole("button", {
      name: /Export violations CSV/i,
    });
    expect(exportButton).toBeEnabled();

    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockExportToCSV).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            __rule: "email not null",
            __compliance: "80.0",
            amount: 100,
            created_at: "2026-01-04",
          }),
        ],
        "orders-quality-violations.csv",
      );
    });
  });
});
