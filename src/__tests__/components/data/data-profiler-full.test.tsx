import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

import DataProfilerFull from "@/components/data/data-profiler-full";
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
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/charts", () => ({ BarChart: {}, HeatmapChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const profilerColumns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 30,
    uniqueCount: 90,
    sampleValues: [100, 120],
  },
  {
    name: "score",
    type: "number",
    nullCount: 0,
    uniqueCount: 95,
    sampleValues: [0.4, 0.8],
  },
  {
    name: "email",
    type: "string",
    nullCount: 10,
    uniqueCount: 80,
    sampleValues: ["ada@example.com", "grace@example.com"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: ["2026-01-01", "2026-02-01"],
  },
  {
    name: "mystery",
    type: "unknown",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: ["x", "y"],
  },
];

const singleNumericColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [10, 20],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
];

const cleanColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [10, 20],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["A", "B"],
  },
];

async function renderAsync(
  nextColumns: ColumnProfile[],
  rowCount: number,
) {
  await act(async () => {
    render(
      <DataProfilerFull
        tableName="sales"
        columns={nextColumns}
        rowCount={rowCount}
      />,
    );
  });

  await waitFor(
    () => {
      expect(
        screen.queryByText("Loading full profiling report…"),
      ).not.toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

function installProfilerMock(mode: "default" | "singleNumeric" | "clean" = "default") {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("duplicate_rows")) {
      return [{ duplicate_rows: mode === "default" ? 4 : 0 }];
    }

    if (sql.includes("CORR(")) {
      return mode === "default"
        ? [{ left_name: "revenue", right_name: "score", corr_value: 0.82 }]
        : [];
    }

    const isRevenue = sql.includes('"revenue"');
    const isSales = sql.includes('"sales"');
    const isEmail = sql.includes('"email"');
    const isCategory = sql.includes('"category"') || sql.includes('"region"');

    if (sql.includes("ORDER BY count DESC, label ASC LIMIT 8")) {
      if (isEmail) return [{ label: "ada@example.com", count: 12 }];
      if (isCategory) return [{ label: "East", count: 10 }];
      return [{ label: "120", count: 20 }];
    }

    if (sql.includes("ORDER BY count ASC, label ASC LIMIT 8")) {
      if (isEmail) return [{ label: "grace@example.com", count: 1 }];
      if (isCategory) return [{ label: "West", count: 2 }];
      return [{ label: "80", count: 1 }];
    }

    if (sql.includes("MIN(LENGTH(")) {
      return [{ min_length: 2, avg_length: 5.4, max_length: 18 }];
    }

    if (sql.includes("regexp_matches")) {
      if (isEmail) {
        return [
          {
            blank_like: 0,
            numeric_like: 0,
            email_like: 12,
            url_like: 0,
            mixed_token: 0,
          },
        ];
      }
      return [
        {
          blank_like: 0,
          numeric_like: isRevenue || isSales ? 8 : 0,
          email_like: 0,
          url_like: 0,
          mixed_token: 0,
        },
      ];
    }

    if (sql.includes("NTILE(12)")) {
      return [
        { label: "80–120", count: 18 },
        { label: "121–160", count: 22 },
      ];
    }

    if (sql.includes("STRFTIME(bucket, '%Y-%m')")) {
      return [
        { label: "2026-01", count: 12 },
        { label: "2026-02", count: 12 },
      ];
    }

    if (sql.includes("ORDER BY count DESC, label ASC LIMIT 10")) {
      if (isEmail) return [{ label: "ada@example.com", count: 12 }];
      return [{ label: "A", count: 6 }];
    }

    return [];
  });
}

describe("DataProfilerFull", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders overview metrics, charts, and recommendations", async () => {
    installProfilerMock();

    await renderAsync(profilerColumns, 100);

    expect(await screen.findByText("Quality breakdown")).toBeInTheDocument();
    expect(screen.getByText("Duplicate rows")).toBeInTheDocument();
    expect(screen.getByText("Data type recommendations")).toBeInTheDocument();
    expect(
      screen.getByText("Add an explicit type cast or schema hint."),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("echart").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the correlation fallback when fewer than two numeric columns exist", async () => {
    installProfilerMock("singleNumeric");

    await renderAsync(singleNumericColumns, 12);

    expect(
      await screen.findByText(
        "Add at least two numeric columns to render the correlation matrix.",
      ),
    ).toBeInTheDocument();
  });

  it("loads detail for the selected column from the navigator", async () => {
    installProfilerMock();

    await renderAsync(profilerColumns, 100);

    await screen.findByText("Column navigator");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /email/i }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Profiling column…")).not.toBeInTheDocument();
    });

    expect(
      await screen.findByText(
        "Email-like values detected; normalize domains and consider masking.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("exports the PDF-ready HTML report for the active column", async () => {
    const user = userEvent.setup();
    installProfilerMock();

    await renderAsync(profilerColumns, 100);

    await screen.findByText("Export PDF-ready HTML");
    await user.click(
      screen.getByRole("button", { name: /Export PDF-ready HTML/i }),
    );

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("Selected column detail: revenue"),
        "sales-profile-report.html",
        "text/html;charset=utf-8;",
      );
    });
  });

  it("shows the no-recommendations state when the profile is clean", async () => {
    installProfilerMock("clean");

    await renderAsync(cleanColumns, 100);

    expect(
      await screen.findByText(
        "No type recommendations were triggered from the current profile.",
      ),
    ).toBeInTheDocument();
  });
});
