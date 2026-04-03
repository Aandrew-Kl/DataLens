import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExpressionCalculator from "@/components/data/expression-calculator";
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

const expressionColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [100, 1200],
  },
  {
    name: "customer_name",
    type: "string",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: ["Ada", "Lin"],
  },
];

async function renderCalculator() {
  await act(async () => {
    render(<ExpressionCalculator tableName="orders" columns={expressionColumns} />);
  });
}

describe("ExpressionCalculator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("inserts CASE snippets and previews the computed values", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ amount: 1200, calculated_metric: "high" }]);

    await renderCalculator();
    await user.click(screen.getByRole("button", { name: /insert case/i }));

    const expressionEditor = screen.getByLabelText(/sql expression/i);
    expect(expressionEditor).toHaveValue(
      "CASE WHEN amount > 1000 THEN 'high' ELSE 'standard' END",
    );

    await user.click(screen.getByRole("button", { name: /preview results/i }));

    expect(await screen.findByText("high")).toBeInTheDocument();
    expect(screen.getByText(/Preview returned 1 row/i)).toBeInTheDocument();
  });

  it("creates a virtual column view from the expression", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([]);

    await renderCalculator();
    fireEvent.change(screen.getByDisplayValue("calculated_metric"), {
      target: { value: "adjusted_amount" },
    });
    fireEvent.change(screen.getByLabelText(/sql expression/i), {
      target: { value: "ROUND(amount * 1.2, 2)" },
    });

    await user.click(screen.getByRole("button", { name: /add as virtual column/i }));

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('CREATE OR REPLACE VIEW "orders__adjusted_amount" AS'),
    );
    expect(await screen.findByText(/Created virtual column view orders__adjusted_amount/i)).toBeInTheDocument();
  });

  it("exports preview rows as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ amount: 250, calculated_metric: "standard" }]);

    await renderCalculator();
    await user.click(screen.getByRole("button", { name: /insert case/i }));
    await user.click(screen.getByRole("button", { name: /preview results/i }));
    await screen.findByText("standard");

    await user.click(screen.getByRole("button", { name: /^export csv$/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("amount,calculated_metric"),
      "orders-calculated_metric-preview.csv",
      "text/csv;charset=utf-8",
    );
  });
});
