import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import MissingValueImputer from "@/components/data/missing-value-imputer";
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

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "age",
    type: "number",
    nullCount: 2,
    uniqueCount: 6,
    sampleValues: [22, 31, 44],
    mean: 32.5,
    median: 31,
  },
  {
    name: "city",
    type: "string",
    nullCount: 1,
    uniqueCount: 4,
    sampleValues: ["Athens", "Berlin"],
  },
  {
    name: "is_active",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

async function renderImputer(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(
      <MissingValueImputer tableName="customers" columns={targetColumns} />,
    );
  });
}

describe("MissingValueImputer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a clean-state message when the dataset has no missing values", async () => {
    await renderImputer(
      columns.map((column) => ({
        ...column,
        nullCount: 0,
      })),
    );

    expect(
      screen.getByText("No missing values were detected, so there is nothing to impute."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("previews changed cells and exports the preview comparison as CSV", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*) FILTER (WHERE "age" IS NULL) AS "remaining_0"')) {
        return [
          {
            remaining_0: 0,
            remaining_1: 0,
            changed_0: 2,
            changed_1: 1,
          },
        ];
      }

      if (sql.includes("ORDER BY row_id, column_name")) {
        return [
          {
            row_id: 1,
            column_name: "age",
            original_value: "null",
            imputed_value: "32.5",
          },
          {
            row_id: 2,
            column_name: "city",
            original_value: "null",
            imputed_value: "Athens",
          },
        ];
      }

      return [];
    });

    await renderImputer();

    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Preview ready with 3 imputed cells."),
      ).toBeInTheDocument();
      expect(screen.getByText("32.5")).toBeInTheDocument();
      expect(screen.getByText("Athens")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("row_id,column_name,original_value,imputed_value"),
      "customers-imputation-preview.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("applies the imputation plan with a table swap after a fresh preview", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1234);

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*) FILTER (WHERE "age" IS NULL) AS "remaining_0"')) {
        return [
          {
            remaining_0: 0,
            remaining_1: 0,
            changed_0: 2,
            changed_1: 1,
          },
        ];
      }

      if (sql.includes("ORDER BY row_id, column_name")) {
        return [
          {
            row_id: 1,
            column_name: "age",
            original_value: "null",
            imputed_value: "32.5",
          },
        ];
      }

      return [];
    });

    await renderImputer();

    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Preview ready with 3 imputed cells."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE "customers__imputed_1234" AS'),
      );
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "customers__imputed_1234"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "customers__backup_1234"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "customers" RENAME TO "customers__backup_1234"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "customers__imputed_1234" RENAME TO "customers"',
    );
    expect(mockRunQuery).toHaveBeenCalledWith('DROP TABLE "customers__backup_1234"');
    expect(
      await screen.findByText("Applied the imputation plan to customers."),
    ).toBeInTheDocument();
  });
});
