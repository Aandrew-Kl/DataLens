import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

import DataEnrichment from "@/components/data/data-enrichment";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "ordered_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["2026-01-15", "2026-02-15"],
  },
  {
    name: "email",
    type: "string",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["ada@example.com", "grace@example.com"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [15, 22],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["SMB", "Enterprise"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataEnrichment tableName="sales" columns={columns} />);
  });

  await waitFor(
    () => {
      expect(screen.queryByText("Building preview…")).not.toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

function installEnrichmentMock(failingCreate = false) {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("LIMIT 12")) {
      if (sql.includes('"ordered_at_year"')) {
        return [{ ordered_at: "2026-01-15", ordered_at_year: 2026 }];
      }

      if (sql.includes('"email_domain"')) {
        return [{ email: "ada@example.com", email_domain: "example.com" }];
      }

      if (sql.includes('"revenue_bin"')) {
        return [{ revenue: 15, revenue_bin: "≤ 20" }];
      }

      return [];
    }

    if (sql.startsWith("DROP TABLE IF EXISTS")) {
      return [];
    }

    if (sql.startsWith("CREATE TABLE")) {
      if (failingCreate) {
        throw new Error("Create failed");
      }
      return [];
    }

    if (sql.startsWith("ALTER TABLE") || sql.startsWith("DROP TABLE ")) {
      return [];
    }

    return [];
  });
}

describe("DataEnrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the default date-part preview and generated SQL", async () => {
    installEnrichmentMock();

    await renderAsync();

    await waitFor(() => {
      expect(
        mockRunQuery.mock.calls.some(([sql]) => sql.includes("LIMIT 12")),
      ).toBe(true);
    });
    expect(screen.getAllByText("ordered_at_year").length).toBeGreaterThan(0);
    expect(screen.getByText(/EXTRACT\(YEAR FROM/i)).toBeInTheDocument();
  });

  it("switches to string domain extraction and updates the preview", async () => {
    installEnrichmentMock();

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[0] as HTMLSelectElement, {
        target: { value: "string_ops" },
      });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("email_initials")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[2] as HTMLSelectElement, {
        target: { value: "domain" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Building preview…")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("email_domain")).toBeInTheDocument();
    });
    expect(
      mockRunQuery.mock.calls.some(([sql]) => sql.includes('"email_domain"')),
    ).toBe(true);
  });

  it("shows a validation warning for custom bins without breakpoints", async () => {
    installEnrichmentMock();

    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[0] as HTMLSelectElement, {
        target: { value: "binning" },
      });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("revenue_bin")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[2] as HTMLSelectElement, {
        target: { value: "custom" },
      });
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("10,25,50,100")).toBeInTheDocument();
    });

    const breakpointsInput = screen.getByPlaceholderText(
      "10,25,50,100",
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(breakpointsInput, {
        target: { value: "foo" },
      });
    });

    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText("10,25,50,100") as HTMLInputElement).value,
      ).toBe("foo");
    });

    await waitFor(() => {
      expect(screen.queryByText("Building preview…")).not.toBeInTheDocument();
    });

    expect(
      await screen.findByText(/Add at least one numeric breakpoint for custom bins\./i),
    ).toBeInTheDocument();
  });

  it("applies the enrichment and replaces the underlying table", async () => {
    const user = userEvent.setup();
    installEnrichmentMock();

    await renderAsync();

    await screen.findByText("Apply enrichment");
    await user.click(screen.getByRole("button", { name: /Apply enrichment/i }));

    expect(
      await screen.findByText(
        "Applied ordered_at_year to sales. Refresh the dataset view to see the new schema.",
      ),
    ).toBeInTheDocument();
    expect(
      mockRunQuery.mock.calls.some(([sql]) => sql.includes("CREATE TABLE")),
    ).toBe(true);
    expect(
      mockRunQuery.mock.calls.some(([sql]) => sql.includes('ALTER TABLE "sales" RENAME TO')),
    ).toBe(true);
  });

  it("shows apply errors when the replacement query fails", async () => {
    const user = userEvent.setup();
    installEnrichmentMock(true);

    await renderAsync();

    await screen.findByText("Apply enrichment");
    await user.click(screen.getByRole("button", { name: /Apply enrichment/i }));

    expect(await screen.findByText("Create failed")).toBeInTheDocument();
  });
});
