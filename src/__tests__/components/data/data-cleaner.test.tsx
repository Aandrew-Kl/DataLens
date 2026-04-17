import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

jest.mock("@/components/data/cleaner-history", () => {
  const ReactModule = require("react") as typeof React;

  return {
    __esModule: true,
    CleanerHistory: ({
      history,
      onUndoLatest,
    }: {
      history: Array<{ id: string; label: string }>;
      onUndoLatest: () => void;
    }) => (
      <section aria-label="history panel">
        <button type="button" onClick={onUndoLatest}>
          Undo Latest
        </button>
        <div>{`history:${history.length}`}</div>
        {history.map((entry) => (
          <div key={entry.id}>{entry.label}</div>
        ))}
      </section>
    ),
  };
});

jest.mock("@/components/data/cleaner-preview", () => {
  const ReactModule = require("react") as typeof React;

  return {
    __esModule: true,
    CleanerPreview: ({
      preview,
      setPreview,
    }: {
      preview: { title: string } | null;
      setPreview: React.Dispatch<React.SetStateAction<{ title: string } | null>>;
    }) => (
      <section aria-label="preview panel">
        <div>{preview ? preview.title : "No preview"}</div>
        {preview ? (
          <button type="button" onClick={() => setPreview(null)}>
            Clear Preview
          </button>
        ) : null}
      </section>
    ),
  };
});

jest.mock("@/components/data/cleaner-rules", () => {
  const ReactModule = require("react") as typeof React;

  return {
    __esModule: true,
    CleanerRules: ({
      issues,
      loading,
      onApplyIssue,
      onPreview,
      previewLoading,
    }: {
      issues: Array<{ id: string; columnName: string }>;
      loading: boolean;
      onApplyIssue: (issue: { id: string; columnName: string }) => void;
      onPreview: (issue: { id: string; columnName: string }) => void;
      previewLoading: string | null;
    }) => (
      <section aria-label="rules panel">
        <div>{loading ? "loading" : `issues:${issues.length}`}</div>
        {issues.map((issue) => (
          <article key={issue.id}>
            <h3>{issue.columnName}</h3>
            <button
              type="button"
              onClick={() => onPreview(issue)}
              disabled={previewLoading === issue.id}
            >
              {`Preview ${issue.columnName}`}
            </button>
            <button type="button" onClick={() => onApplyIssue(issue)}>
              {`Apply ${issue.columnName}`}
            </button>
          </article>
        ))}
      </section>
    ),
    actionLabelForIssue: jest.fn((issue: { columnName: string }) => `Action ${issue.columnName}`),
    buildNullStrategyMap: jest.fn(
      (
        columns: Array<{ name: string }>,
        current: Record<string, "mode" | "median" | "custom" | "mean">,
      ) =>
        Object.fromEntries(
          columns.map((column) => [column.name, current[column.name] ?? "mode"]),
        ),
    ),
    defaultNullStrategy: jest.fn(() => "mode"),
    loadIssuePreview: jest.fn(),
    quoteId: jest.fn((value: string) => `"${value}"`),
    scanDataIssues: jest.fn(),
    selectSqlForIssue: jest.fn(),
  };
});

import DataCleaner, {
  CleanerHistory as ReExportedHistory,
  CleanerPreview as ReExportedPreview,
  CleanerRules as ReExportedRules,
  actionLabelForIssue as reExportedActionLabelForIssue,
  buildNullStrategyMap as reExportedBuildNullStrategyMap,
  loadIssuePreview as reExportedLoadIssuePreview,
  quoteId as reExportedQuoteId,
  scanDataIssues as reExportedScanDataIssues,
  selectSqlForIssue as reExportedSelectSqlForIssue,
} from "@/components/data/data-cleaner";
import {
  actionLabelForIssue,
  buildNullStrategyMap,
  loadIssuePreview,
  quoteId,
  scanDataIssues,
  selectSqlForIssue,
} from "@/components/data/cleaner-rules";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

const mockActionLabelForIssue = jest.mocked(actionLabelForIssue);
const mockBuildNullStrategyMap = jest.mocked(buildNullStrategyMap);
const mockLoadIssuePreview = jest.mocked(loadIssuePreview);
const mockQuoteId = jest.mocked(quoteId);
const mockRunQuery = jest.mocked(runQuery);
const mockScanDataIssues = jest.mocked(scanDataIssues);
const mockSelectSqlForIssue = jest.mocked(selectSqlForIssue);

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

const criticalIssue = {
  id: "nulls:region",
  type: "nulls" as const,
  severity: "critical" as const,
  columnName: "region",
  description: "10 rows are missing a value in region.",
  affectedRows: 10,
  suggestedFix: "Fill with the mode.",
};

const secondCriticalIssue = {
  id: "whitespace:region",
  type: "whitespace" as const,
  severity: "critical" as const,
  columnName: "region",
  description: "3 rows have leading or trailing whitespace.",
  affectedRows: 3,
  suggestedFix: "Trim whitespace in place.",
};

const warningIssue = {
  id: "outliers:revenue",
  type: "outliers" as const,
  severity: "warning" as const,
  columnName: "revenue",
  description: "2 rows sit outside the IQR bounds for revenue.",
  affectedRows: 2,
  suggestedFix: "Remove rows outside the interquartile range.",
};

describe("DataCleaner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActionLabelForIssue.mockImplementation(
      (issue) => `Action ${issue.columnName}`,
    );
    mockBuildNullStrategyMap.mockImplementation(
      (nextColumns, current) =>
        Object.fromEntries(
          nextColumns.map((column) => [column.name, current[column.name] ?? "mode"]),
        ),
    );
    mockLoadIssuePreview.mockResolvedValue({
      issueId: criticalIssue.id,
      title: "region preview",
      sql: "SELECT 1",
      rows: [],
    });
    mockQuoteId.mockImplementation((value) => `"${value}"`);
    mockRunQuery.mockResolvedValue([]);
    mockScanDataIssues.mockResolvedValue({ issues: [], rowCount: 0 });
    mockSelectSqlForIssue.mockReturnValue('SELECT * FROM "sales"');
  });

  it("re-exports cleaner helpers and handles empty scans with no-op actions", async () => {
    const user = userEvent.setup();

    render(
      <DataCleaner
        tableName="sales"
        columns={[]}
        onCleanComplete={jest.fn()}
      />,
    );

    expect(ReExportedHistory).toBeDefined();
    expect(ReExportedPreview).toBeDefined();
    expect(ReExportedRules).toBeDefined();
    expect(reExportedActionLabelForIssue).toBe(actionLabelForIssue);
    expect(reExportedBuildNullStrategyMap).toBe(buildNullStrategyMap);
    expect(reExportedLoadIssuePreview).toBe(loadIssuePreview);
    expect(reExportedQuoteId).toBe(quoteId);
    expect(reExportedScanDataIssues).toBe(scanDataIssues);
    expect(reExportedSelectSqlForIssue).toBe(selectSqlForIssue);
    expect(mockScanDataIssues).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /fix all critical/i }));
    expect(await screen.findByText("No critical issues are available.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /undo latest/i }));
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads and clears previews for detected issues", async () => {
    const user = userEvent.setup();
    mockScanDataIssues.mockResolvedValueOnce({
      issues: [criticalIssue],
      rowCount: 100,
    });

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /preview region/i }));

    expect(mockLoadIssuePreview).toHaveBeenCalledWith(
      "sales",
      columns,
      criticalIssue,
      expect.any(Object),
      expect.any(Object),
    );
    expect(await screen.findByText("region preview")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear preview/i }));
    expect(screen.getAllByText("No preview")).toHaveLength(1);
  });

  it("surfaces preview failures as error notices", async () => {
    const user = userEvent.setup();
    mockScanDataIssues.mockResolvedValueOnce({
      issues: [criticalIssue],
      rowCount: 100,
    });
    mockLoadIssuePreview.mockRejectedValueOnce(new Error("Preview failed"));

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /preview region/i }));

    expect(await screen.findByText("Preview failed")).toBeInTheDocument();
  });

  it("applies a single issue, refreshes the scan, and records history", async () => {
    const onCleanComplete = jest.fn();
    const user = userEvent.setup();

    mockScanDataIssues
      .mockResolvedValueOnce({ issues: [criticalIssue], rowCount: 100 })
      .mockResolvedValueOnce({ issues: [], rowCount: 100 });
    mockActionLabelForIssue.mockReturnValueOnce("Filled nulls in region");
    mockSelectSqlForIssue.mockReturnValueOnce('SELECT * FROM "sales"');

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={onCleanComplete}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /apply region/i }));

    await waitFor(() => {
      expect(screen.getByText("Fill with the mode. Applied to sales.")).toBeInTheDocument();
    });
    await waitFor(() => expect(onCleanComplete).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Filled nulls in region")).toBeInTheDocument();
    expect(screen.getByText("history:1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset all/i })).toBeEnabled();
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringMatching(/^DROP TABLE IF EXISTS "sales__clean_/),
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringMatching(/^CREATE TABLE "sales__clean_.*" AS SELECT \* FROM "sales"$/),
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringMatching(/^ALTER TABLE "sales__clean_.*" RENAME TO "sales"$/),
    );
  });

  it("shows apply errors and rolls back failed rewrites", async () => {
    const user = userEvent.setup();

    mockScanDataIssues.mockResolvedValueOnce({
      issues: [criticalIssue],
      rowCount: 100,
    });
    mockActionLabelForIssue.mockReturnValueOnce("Filled nulls in region");
    mockRunQuery.mockImplementation(async (sql) => {
      if (/^ALTER TABLE "sales__clean_.*" RENAME TO "sales"$/.test(sql)) {
        throw new Error("swap failed");
      }

      return [];
    });

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /apply region/i }));

    expect(await screen.findByText("swap failed")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringMatching(/^ALTER TABLE "sales__backup_.*" RENAME TO "sales"$/),
    );
  });

  it("undoes the latest applied fix and restores the previous scan state", async () => {
    const user = userEvent.setup();
    const onCleanComplete = jest.fn();

    mockScanDataIssues
      .mockResolvedValueOnce({ issues: [criticalIssue], rowCount: 100 })
      .mockResolvedValueOnce({ issues: [], rowCount: 100 })
      .mockResolvedValueOnce({ issues: [criticalIssue], rowCount: 100 });
    mockActionLabelForIssue.mockReturnValue("Filled nulls in region");

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={onCleanComplete}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /apply region/i }));
    await screen.findByText("history:1");

    await user.click(screen.getByRole("button", { name: /undo latest/i }));

    await waitFor(() => {
      expect(screen.getByText("Reverted: Filled nulls in region.")).toBeInTheDocument();
    });
    await waitFor(() => expect(onCleanComplete).toHaveBeenCalledTimes(2));
    expect(screen.getByText("history:0")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringMatching(/^ALTER TABLE "sales" RENAME TO "sales__restore_/),
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringMatching(/^DROP TABLE "sales__restore_/),
    );
  });

  it("surfaces undo failures and restores the live table name", async () => {
    const user = userEvent.setup();

    mockScanDataIssues
      .mockResolvedValueOnce({ issues: [criticalIssue], rowCount: 100 })
      .mockResolvedValueOnce({ issues: [], rowCount: 100 });
    mockActionLabelForIssue.mockReturnValue("Filled nulls in region");
    mockRunQuery.mockImplementation(async (sql) => {
      if (/^ALTER TABLE "sales__backup_.*" RENAME TO "sales"$/.test(sql)) {
        throw new Error("restore failed");
      }

      return [];
    });

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /apply region/i }));
    await screen.findByText("history:1");
    await user.click(screen.getByRole("button", { name: /undo latest/i }));

    await waitFor(() => {
      expect(screen.getByText("restore failed")).toBeInTheDocument();
    });
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringMatching(/^ALTER TABLE "sales__restore_.*" RENAME TO "sales"$/),
    );
  });

  it("bulk applies matching severities and reset all restores every recorded fix", async () => {
    const user = userEvent.setup();
    const onCleanComplete = jest.fn();

    mockScanDataIssues
      .mockResolvedValueOnce({
        issues: [criticalIssue, secondCriticalIssue, warningIssue],
        rowCount: 100,
      })
      .mockResolvedValueOnce({ issues: [warningIssue], rowCount: 100 })
      .mockResolvedValueOnce({
        issues: [criticalIssue, secondCriticalIssue, warningIssue],
        rowCount: 100,
      });
    mockActionLabelForIssue.mockImplementation(
      (issue) => `Applied ${issue.columnName} (${issue.id})`,
    );
    mockSelectSqlForIssue.mockImplementation(
      (_tableName, _columns, issue) => `SELECT * FROM cleaned_${issue.id}`,
    );

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={onCleanComplete}
      />,
    );

    await screen.findByText("issues:3");
    await user.click(screen.getByRole("button", { name: /fix all critical/i }));

    await waitFor(() => {
      expect(screen.getByText("Applied 2 critical fixes.")).toBeInTheDocument();
    });
    expect(screen.getByText("history:2")).toBeInTheDocument();
    expect(screen.getByText("Applied region (nulls:region)")).toBeInTheDocument();
    expect(screen.getByText("Applied region (whitespace:region)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reset all/i }));

    await waitFor(() => {
      expect(screen.getByText("Reverted every applied cleaning step.")).toBeInTheDocument();
    });
    await waitFor(() => expect(onCleanComplete).toHaveBeenCalledTimes(2));
    expect(screen.getByText("history:0")).toBeInTheDocument();
  });

  it("surfaces bulk-apply failures", async () => {
    const user = userEvent.setup();

    mockScanDataIssues.mockResolvedValueOnce({
      issues: [criticalIssue],
      rowCount: 100,
    });
    mockSelectSqlForIssue.mockImplementationOnce(() => {
      throw new Error("bulk failed");
    });

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    await screen.findByText("issues:1");
    await user.click(screen.getByRole("button", { name: /fix all critical/i }));

    await waitFor(() => {
      expect(screen.getByText("bulk failed")).toBeInTheDocument();
    });
  });

  it("surfaces reset failures after a bulk apply", async () => {
    const user = userEvent.setup();

    mockScanDataIssues
      .mockResolvedValueOnce({
        issues: [criticalIssue, secondCriticalIssue],
        rowCount: 100,
      })
      .mockResolvedValueOnce({ issues: [], rowCount: 100 });
    mockActionLabelForIssue.mockImplementation(
      (issue) => `Applied ${issue.columnName} (${issue.id})`,
    );
    mockRunQuery.mockImplementation(async (sql) => {
      if (/^ALTER TABLE "sales__backup_.*" RENAME TO "sales"$/.test(sql)) {
        throw new Error("reset failed");
      }

      return [];
    });

    render(
      <DataCleaner
        tableName="sales"
        columns={columns}
        onCleanComplete={jest.fn()}
      />,
    );

    await screen.findByText("issues:2");
    await user.click(screen.getByRole("button", { name: /fix all critical/i }));
    await screen.findByText("history:2");
    await user.click(screen.getByRole("button", { name: /reset all/i }));

    await waitFor(() => {
      expect(screen.getByText("reset failed")).toBeInTheDocument();
    });
  });
});
