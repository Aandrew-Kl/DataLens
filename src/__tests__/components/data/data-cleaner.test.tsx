import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataCleaner from "@/components/data/data-cleaner";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 10,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 90,
    sampleValues: [100, 200],
  },
];

function installScanMocks(nullCount = 10) {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes('SELECT COUNT(*) AS cnt FROM "sales"')) {
      return [{ cnt: 100 }];
    }
    if (sql.includes('AS "n0"') && sql.includes('AS "n1"')) {
      return [{ n0: nullCount, n1: 0 }];
    }
    if (sql.includes('AS "w0"')) {
      return [{ w0: 0 }];
    }
    if (sql.includes("duplicate_groups")) {
      return [{ duplicate_rows: 0, duplicate_groups: 0 }];
    }
    if (sql.includes('quantile_cont("revenue", 0.25)')) {
      return [{ lower_bound: 0, upper_bound: 500, outlier_rows: 0 }];
    }
    if (sql.includes("boolean_count")) {
      return [
        {
          non_null_count: 100 - nullCount,
          numeric_count: 0,
          date_count: 0,
          boolean_count: 0,
        },
      ];
    }
    if (sql.includes('WHERE "region" IS NULL') && sql.includes("before_value")) {
      return [
        {
          before_value: "null",
          after_value: "East",
          detail: "East • 120",
        },
      ];
    }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  });
}

describe("DataCleaner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders detected issues and previews a null-filling fix", async () => {
    const user = userEvent.setup();

    installScanMocks(10);

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    expect(
      await screen.findByText("10 rows are missing a value in region."),
    ).toBeInTheDocument();
    expect(screen.getByText("Issues found")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /preview/i }));

    expect(await screen.findByText("region preview")).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
    expect(screen.getByText("East")).toBeInTheDocument();
  });

  it("shows a validation error when a custom null value is required but missing", async () => {
    const user = userEvent.setup();

    installScanMocks(10);

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    const issueCard = (await screen.findByRole("heading", {
      name: "region",
    })).closest("article");

    expect(issueCard).not.toBeNull();

    await user.selectOptions(
      within(issueCard ?? document.body).getByDisplayValue("Mode"),
      "custom",
    );
    await user.click(
      within(issueCard ?? document.body).getByRole("button", {
        name: /preview/i,
      }),
    );

    expect(
      await screen.findByText(
        "Provide a custom value for region before previewing the fix.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the no-issues state when the scan finds nothing actionable", async () => {
    installScanMocks(0);

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    expect(
      await screen.findByText(/No active issues are left in the current table snapshot\./i),
    ).toBeInTheDocument();
  });
});
