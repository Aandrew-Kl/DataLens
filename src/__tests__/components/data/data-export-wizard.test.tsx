import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DataExportWizard from "@/components/data/data-export-wizard";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({ downloadFile: jest.fn() }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2, 3],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["active", "paused"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataExportWizard tableName="orders" columns={columns} />);
  });
}

function installExportMocks() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes('LIMIT 5')) {
      return [
        { id: 1, status: "active" },
        { id: 2, status: "paused" },
      ];
    }

    if (sql.includes('LIMIT 50')) {
      return [
        { id: 1, status: "active" },
        { id: 2, status: "paused" },
      ];
    }

    return [];
  });
}

describe("DataExportWizard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("moves through the wizard and loads a preview", async () => {
    installExportMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    expect(screen.getByLabelText("Row limit")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    expect(await screen.findByText("active")).toBeInTheDocument();
    expect(screen.getByText("Loaded 2 preview rows for CSV.")).toBeInTheDocument();
  });

  it("downloads JSON after finishing the wizard", async () => {
    installExportMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /json/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    await screen.findByText("Loaded 2 preview rows for JSON.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download export/i }));
    });

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining('"status": "active"'),
        "orders-export.json",
        "application/json;charset=utf-8;",
      );
    });
  });

  it("shows Excel-specific options in the summary step", async () => {
    installExportMocks();

    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /excel/i }));
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Sheet name"), {
        target: { value: "Forecast" },
      });
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    await screen.findByText("Loaded 2 preview rows for EXCEL.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });

    expect(screen.getByText("Sheet name: Forecast")).toBeInTheDocument();
  });
});
