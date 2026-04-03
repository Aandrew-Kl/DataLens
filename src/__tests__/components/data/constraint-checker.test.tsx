import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ConstraintChecker from "@/components/data/constraint-checker";
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
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [1, 2],
  },
  {
    name: "customer_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: ["c-1", "c-2"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 1,
    uniqueCount: 8,
    sampleValues: [25, 50],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["paid", "open"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ConstraintChecker tableName="orders" columns={columns} />);
  });
}

describe("ConstraintChecker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the four constraint definition controls", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Validate structural data rules before delivery",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Primary key column")).toBeInTheDocument();
    expect(screen.getByLabelText("Reference table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run validation" })).toBeInTheDocument();
  });

  it("runs validation and surfaces pass and fail results", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([{ violation_count: 0 }])
      .mockResolvedValueOnce([{ violation_count: 2 }])
      .mockResolvedValueOnce([{ violation_count: 1 }])
      .mockResolvedValueOnce([{ violation_count: 0 }]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Run validation" }));

    expect(await screen.findByText(/Primary key uniqueness \(id\)/i)).toBeInTheDocument();
    expect(screen.getByText(/All monitored columns are fully populated/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference misses were found/i)).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledTimes(4);
  });

  it("exports the constraint report after validation", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([{ violation_count: 0 }])
      .mockResolvedValueOnce([{ violation_count: 0 }])
      .mockResolvedValueOnce([{ violation_count: 0 }])
      .mockResolvedValueOnce([{ violation_count: 0 }]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Run validation" }));
    await screen.findByText(/Primary key uniqueness \(id\)/i);

    await user.click(screen.getByRole("button", { name: "Export report" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("rule_name,status,violation_count,detail"),
      "orders-constraint-report.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
