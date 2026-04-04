import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import StatisticalTests from "@/components/data/statistical-tests";
import { runQuery } from "@/lib/duckdb/client";
import {
  runChiSquare,
  runTTest,
} from "@/lib/utils/statistical-test-engine";
import type { ColumnProfile } from "@/types/dataset";
import type { TestResult } from "@/lib/utils/statistical-test-engine";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/utils/statistical-test-engine", () => {
  const actual =
    jest.requireActual<typeof import("@/lib/utils/statistical-test-engine")>(
      "@/lib/utils/statistical-test-engine",
    );
  return {
    ...actual,
    runTTest: jest.fn(),
    runChiSquare: jest.fn(),
    runAnova: jest.fn(),
    runMannWhitney: jest.fn(),
    runKolmogorovSmirnov: jest.fn(),
  };
});

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockRunTTest = runTTest as jest.MockedFunction<typeof runTTest>;
const mockRunChiSquare = runChiSquare as jest.MockedFunction<typeof runChiSquare>;

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 40,
    sampleValues: [100, 200],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Retail", "Enterprise"],
  },
  {
    name: "channel",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Online", "Field"],
  },
];

function makeResult(patch: Partial<TestResult>): TestResult {
  return {
    id: "result-1",
    type: "t-test",
    title: "revenue: Retail vs Enterprise",
    statisticLabel: "t statistic",
    statistic: 2.12,
    pValue: 0.03,
    confidenceInterval: [10, 30],
    effectLabel: "Cohen's d",
    effectSize: 0.54,
    interpretation: "A measurable difference was detected.",
    significant: true,
    details: [
      { label: "Retail mean", value: "120" },
      { label: "Enterprise mean", value: "98" },
    ],
    sql: "select 1",
    runAt: 1,
    ...patch,
  };
}

describe("StatisticalTests", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunTTest.mockReset();
    mockRunChiSquare.mockReset();
    window.sessionStorage.clear();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('CAST("segment" AS VARCHAR) AS value')) {
        return [
          { value: "Retail", count: 12 },
          { value: "Enterprise", count: 10 },
        ];
      }
      if (sql.includes('CAST("channel" AS VARCHAR) AS value')) {
        return [
          { value: "Online", count: 15 },
          { value: "Field", count: 8 },
        ];
      }
      return [];
    });
  });

  it("loads available group values for the active test", async () => {
    render(
      <StatisticalTests tableName="orders" columns={columns} rowCount={100} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Loaded group values for segment: Retail, Enterprise"),
      ).toBeInTheDocument();
      expect(screen.getByText("Retail vs Enterprise")).toBeInTheDocument();
    });
  });

  it("runs a t-test and records it in session history", async () => {
    mockRunTTest.mockResolvedValueOnce(makeResult({}));

    render(
      <StatisticalTests tableName="orders" columns={columns} rowCount={100} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Loaded group values for segment: Retail, Enterprise"),
      ).toBeInTheDocument();
      expect(screen.getByText("Retail vs Enterprise")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    await waitFor(() => {
      expect(mockRunTTest).toHaveBeenCalledWith(
        "orders",
        expect.objectContaining({
          measure: "revenue",
          group: "segment",
          groupA: "Retail",
          groupB: "Enterprise",
        }),
      );
      expect(screen.getByText("Signal detected")).toBeInTheDocument();
      expect(screen.getAllByText("revenue: Retail vs Enterprise")).toHaveLength(2);
    });

    const storedHistory = JSON.parse(
      window.sessionStorage.getItem("datalens:statistical-tests:orders") ?? "[]",
    ) as Array<{ title: string }>;

    expect(storedHistory[0]?.title).toBe("revenue: Retail vs Enterprise");
  });

  it("switches to chi-square and renders the returned result", async () => {
    mockRunChiSquare.mockResolvedValueOnce(
      makeResult({
        id: "result-2",
        type: "chi-square",
        title: "segment x channel",
        statisticLabel: "Chi-square",
        statistic: 8.4,
        pValue: 0.01,
        confidenceInterval: null,
        effectLabel: "Cramer's V",
        effectSize: 0.41,
        interpretation: "The category mix shifts across the compared columns.",
      }),
    );

    render(
      <StatisticalTests tableName="orders" columns={columns} rowCount={100} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Loaded group values for segment: Retail, Enterprise"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Chi-square/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    await waitFor(() => {
      expect(mockRunChiSquare).toHaveBeenCalledWith(
        "orders",
        expect.objectContaining({
          left: "segment",
          right: "channel",
        }),
      );
      expect(screen.getAllByText("segment x channel")).toHaveLength(2);
      expect(screen.getByText("Cramer's V")).toBeInTheDocument();
    });
  });

  it("surfaces execution errors from the statistical engine", async () => {
    mockRunTTest.mockRejectedValueOnce(new Error("Test execution failed"));

    render(
      <StatisticalTests tableName="orders" columns={columns} rowCount={100} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Loaded group values for segment: Retail, Enterprise"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    await waitFor(() => {
      expect(screen.getByText("Test execution failed")).toBeInTheDocument();
    });
  });
});
