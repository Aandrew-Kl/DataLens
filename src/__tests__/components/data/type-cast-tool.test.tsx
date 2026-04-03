import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TypeCastTool from "@/components/data/type-cast-tool";
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

const castColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "string",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: ["10", "15.5"],
  },
];

async function renderTool() {
  await act(async () => {
    render(<TypeCastTool tableName="orders" columns={castColumns} />);
  });
}

describe("TypeCastTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("previews cast results and failed conversions", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.includes("failed_count")) {
        return [{ failed_count: 1 }];
      }
      if (query.includes("cast_value")) {
        return [
          { original_value: "10", cast_value: "10", failed_cast: false },
          { original_value: "bad", cast_value: null, failed_cast: true },
        ];
      }
      return [];
    });

    await renderTool();
    fireEvent.change(screen.getByLabelText(/target type/i), {
      target: { value: "number" },
    });
    await user.click(screen.getByRole("button", { name: /preview cast results/i }));

    expect(await screen.findByText(/1 failed casts detected/i)).toBeInTheDocument();
    expect(screen.getByText("bad")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("applies the cast into a new DuckDB column", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([]);

    await renderTool();
    fireEvent.change(screen.getByLabelText(/target type/i), {
      target: { value: "number" },
    });
    await user.click(screen.getByRole("button", { name: /apply new column/i }));

    expect(mockRunQuery).toHaveBeenCalledWith(
      'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "amount_number" DOUBLE',
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      'UPDATE "orders" SET "amount_number" = TRY_CAST("amount" AS DOUBLE)',
    );
    expect(await screen.findByText(/Created amount_number from amount/i)).toBeInTheDocument();
  });

  it("exports the preview rows as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.includes("failed_count")) {
        return [{ failed_count: 0 }];
      }
      if (query.includes("cast_value")) {
        return [{ original_value: "10", cast_value: "10", failed_cast: false }];
      }
      return [];
    });

    await renderTool();
    await user.click(screen.getByRole("button", { name: /preview cast results/i }));
    await screen.findByText(/Preview loaded for amount/i);
    await user.click(screen.getByRole("button", { name: /export preview csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("original_value,cast_value,failed_cast"),
      "orders-amount-string-preview.csv",
      "text/csv;charset=utf-8",
    );
  });
});
