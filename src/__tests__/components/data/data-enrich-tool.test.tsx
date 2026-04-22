import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import DataEnrichTool from "@/components/data/data-enrich-tool";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "ordered_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["2000-01-01", "1996-08-15"],
  },
  {
    name: "email",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["ada@example.com", "grace@openai.com"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [20, 40],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataEnrichTool tableName="orders" columns={columns} />);
  });
}

function installEnrichmentMocks() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes('"ordered_at_age_years"')) {
      return [{ source_value: "2000-01-01", ordered_at_age_years: "26" }];
    }

    if (sql.includes('"email_domain"')) {
      return [{ source_value: "ada@example.com", email_domain: "example.com" }];
    }

    if (sql.includes("CREATE TABLE") || sql.includes("ALTER TABLE") || sql.includes("DROP TABLE")) {
      return [];
    }

    return [];
  });
}

describe("DataEnrichTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("previews age-from-date enrichment", async () => {
    installEnrichmentMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview enrichment/i }));
    });

    expect(await screen.findByText("26")).toBeInTheDocument();
    expect(
      await screen.findByText("Previewed 1 enriched rows for ordered_at."),
    ).toBeInTheDocument();
  });

  it("switches to email domain enrichment and refreshes the preview", async () => {
    installEnrichmentMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Enrichment mode"), {
        target: { value: "domain" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview enrichment/i }));
    });

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(
      await screen.findByText("Previewed 1 enriched rows for email."),
    ).toBeInTheDocument();
  });

  it("applies the enrichment back into DuckDB", async () => {
    installEnrichmentMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview enrichment/i }));
    });

    await screen.findByText("Previewed 1 enriched rows for ordered_at.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply enrichment/i }));
    });

    expect(
      mockRunQuery.mock.calls.some(([sql]) => sql.includes("CREATE TABLE")),
    ).toBe(true);
    expect(
      mockRunQuery.mock.calls.some(([sql]) =>
        sql.includes('ALTER TABLE "orders" RENAME TO'),
      ),
    ).toBe(true);
    expect(await screen.findByText("Applied ordered_at_age_years to orders.")).toBeInTheDocument();
  });
});
