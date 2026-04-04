import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataTour from "@/components/ui/data-tour";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);

const tourColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 20,
    uniqueCount: 45,
    sampleValues: [10, 20],
    min: 10,
    max: 120,
    median: 50,
  },
  {
    name: "profit",
    type: "number",
    nullCount: 10,
    uniqueCount: 40,
    sampleValues: [4, 8],
    min: -10,
    max: 60,
    median: 20,
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["new", "won"],
  },
  {
    name: "order_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: ["ORD-100", "ORD-101"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: ["2026-01-01", "2026-01-02"],
    min: "2026-01-01",
    max: "2026-02-19",
  },
];

const identifierColumns: ColumnProfile[] = [
  {
    name: "customer_email",
    type: "string",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: ["ada@example.com", "grace@example.com"],
  },
];

function installTourMock() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("COUNT(*) AS row_count")) {
      return [{ row_count: 50 }];
    }
    if (sql.includes("ORDER BY ABS(corr_value) DESC NULLS LAST LIMIT 1")) {
      return [
        {
          left_name: "sales",
          right_name: "profit",
          corr_value: 0.82,
          pair_count: 40,
        },
      ];
    }
    if (sql.includes("ORDER BY value_count DESC, label")) {
      return [
        { label: "new", value_count: 30 },
        { label: "won", value_count: 20 },
      ];
    }
    return [];
  });
}

async function renderTour(
  columns: ColumnProfile[],
  tableName = "orders",
) {
  await act(async () => {
    render(<DataTour tableName={tableName} columns={columns} />);
  });

  await waitFor(() => {
    expect(screen.queryByText("Generating the dataset tour…")).not.toBeInTheDocument();
  });
}

describe("DataTour", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the generated overview and completeness narrative", async () => {
    installTourMock();

    await renderTour(tourColumns);

    expect(
      await screen.findByRole("heading", { name: "Walkthrough for orders" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "orders at a glance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Estimated completeness is 88\.0% across the full cell grid\./),
    ).toBeInTheDocument();
  });

  it("lets the user navigate between generated steps", async () => {
    const user = userEvent.setup();

    installTourMock();
    await renderTour(tourColumns);

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(
      await screen.findByRole("heading", {
        name: "sales is the biggest missing-data hotspot",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /status is already a good slice/i }),
    );

    expect(
      await screen.findByRole("heading", { name: "status is already a good slice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      await screen.findByRole("heading", {
        name: "sales and profit move together",
      }),
    ).toBeInTheDocument();
  });

  it("can be skipped and reopened", async () => {
    const user = userEvent.setup();

    installTourMock();
    await renderTour(tourColumns);

    await user.click(screen.getByRole("button", { name: /skip tour/i }));

    expect(
      await screen.findByText(
        "The tour is hidden. Reopen it any time to revisit the strongest data signals.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen" }));

    expect(
      await screen.findByRole("heading", { name: "orders at a glance" }),
    ).toBeInTheDocument();
  });

  it("falls back to the identifier step when a high-cardinality key stands out", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 20 }];
      }
      return [];
    });

    await renderTour(identifierColumns, "contacts");

    await user.click(
      screen.getByRole("button", { name: /customer_email looks like a reliable key/i }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "customer_email looks like a reliable key",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("customer_email contains email-like patterns."),
    ).toBeInTheDocument();
  });
});
