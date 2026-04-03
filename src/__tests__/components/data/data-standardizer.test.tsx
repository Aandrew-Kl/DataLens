import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataStandardizer from "@/components/data/data-standardizer";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: (_target, tag) =>
          React.forwardRef(function MockMotion(
            props: Record<string, unknown> & { children?: ReactNode },
            ref: React.Ref<Element>,
          ) {
            return React.createElement(String(tag), { ...props, ref }, props.children);
          }),
      },
    ),
  };
});

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "ordered_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "phone",
    type: "string",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["5551112222", "(555) 111-3333"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataStandardizer tableName="orders" columns={columns} />);
  });
}

describe("DataStandardizer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the standardization workspace and controls", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Standardize mixed formatting before downstream analysis",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Standardization operation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeInTheDocument();
  });

  it("previews standardized values and exports them as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('"ordered_at"')) {
        return [{ original_value: "2026/01/01", standardized_value: "2026-01-01" }];
      }
      return [{ original_value: "5551112222", standardized_value: "(555) 111-2222" }];
    });

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByText("2026-01-01")).toBeInTheDocument();
    expect(screen.getByText("(555) 111-2222")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("column_name,original_value,standardized_value"),
      "orders-standardizer-preview.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("applies standardized DuckDB columns for every selected field", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Apply via DuckDB" }));

    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ordered_at_standardized" VARCHAR',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "orders" SET "ordered_at_standardized" = COALESCE(STRFTIME'),
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "phone_standardized" VARCHAR',
    );
    expect(await screen.findByText(/Created 2 standardized DuckDB columns/i)).toBeInTheDocument();
  });
});
