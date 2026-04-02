import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExportWizard from "@/components/data/export-wizard";
import { runQuery } from "@/lib/duckdb/client";
import {
  downloadFile,
  exportToCSV,
  exportToJSON,
} from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
  exportToCSV: jest.fn(),
  exportToJSON: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;
const mockExportToCSV = exportToCSV as jest.MockedFunction<typeof exportToCSV>;
const mockExportToJSON = exportToJSON as jest.MockedFunction<typeof exportToJSON>;

const exportColumns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2, 3],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["active", "inactive"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [10, 20, 30],
  },
];

describe("ExportWizard", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockDownloadFile.mockReset();
    mockExportToCSV.mockReset();
    mockExportToJSON.mockReset();
  });

  it("walks through the wizard and exports JSON with the selected options", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) as cnt")) {
        return [{ cnt: 3 }];
      }

      if (sql.includes("LIMIT 5")) {
        return [
          { id: 1, status: "active" },
          { id: 2, status: "active" },
        ];
      }

      if (sql.includes("LIMIT 2")) {
        return [
          { id: 1, status: "active" },
          { id: 2, status: "active" },
        ];
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    render(
      <ExportWizard
        open
        onClose={onClose}
        tableName="orders"
        columns={exportColumns}
        rowCount={3}
      />,
    );

    expect(screen.getByRole("dialog", { name: /export wizard/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^json\b/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("3 of 3 columns selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /select none/i }));
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();

    const [idCheckbox, statusCheckbox] = screen.getAllByRole("checkbox");
    await user.click(idCheckbox);
    await user.click(statusCheckbox);
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Row limit")).toBeInTheDocument();

    await user.type(screen.getByRole("spinbutton"), "2");
    await user.type(
      screen.getByPlaceholderText("e.g. age > 30 AND status = 'active'"),
      "status = 'active'",
    );

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("active")).toHaveLength(2);
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE status = \'active\''),
    );

    await user.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() => {
      expect(mockExportToJSON).toHaveBeenCalledWith(
        [
          { id: 1, status: "active" },
          { id: 2, status: "active" },
        ],
        "orders.json",
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty preview state when no rows match the filters", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) as cnt")) {
        return [{ cnt: 0 }];
      }

      return [];
    });

    render(
      <ExportWizard
        open
        onClose={jest.fn()}
        tableName="orders"
        columns={exportColumns}
        rowCount={3}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("3 of 3 columns selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Row limit")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(
      await screen.findByText("No rows match the current filters"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeDisabled();
  });

  it("closes when escape is pressed", () => {
    const onClose = jest.fn();

    render(
      <ExportWizard
        open
        onClose={onClose}
        tableName="orders"
        columns={exportColumns}
        rowCount={3}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
