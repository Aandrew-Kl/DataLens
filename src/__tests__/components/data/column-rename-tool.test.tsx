import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ColumnRenameTool from "@/components/data/column-rename-tool";
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
  const motion = new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        React.forwardRef(function MockMotion(
          props: Record<string, unknown>,
          ref: React.ForwardedRef<HTMLElement>,
        ) {
          const {
            animate,
            children,
            exit,
            initial,
            layout,
            layoutId,
            transition,
            whileHover,
            whileTap,
            ...rest
          } = props;
          void animate;
          void exit;
          void initial;
          void layout;
          void layoutId;
          void transition;
          void whileHover;
          void whileTap;
          return React.createElement(
            String(prop),
            { ...rest, ref },
            children as React.ReactNode,
          );
        }),
    },
  );

  return {
    __esModule: true,
    motion,
  };
});

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "customer_name",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Ada", "Grace"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
    min: 10,
    max: 40,
    mean: 25,
    median: 25,
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ColumnRenameTool tableName="orders" columns={columns} />);
  });
}

describe("ColumnRenameTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("applies ALTER TABLE statements for renamed columns", async () => {
    await renderAsync();

    const inputs = screen.getAllByDisplayValue(/customer_name|revenue/);
    fireEvent.change(inputs[0], { target: { value: "customer_label" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply rename" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'ALTER TABLE "orders" RENAME COLUMN "customer_name" TO "customer_label"',
      );
    });

    expect(screen.getByText("Applied 1 column rename(s).")).toBeInTheDocument();
  });

  it("exports the current rename mapping as JSON", async () => {
    await renderAsync();

    fireEvent.change(screen.getByDisplayValue("customer_name"), {
      target: { value: "customer_label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining('"from": "customer_name"'),
      "orders-rename-map.json",
      "application/json;charset=utf-8;",
    );
  });

  it("undoes the last rename batch", async () => {
    await renderAsync();

    fireEvent.change(screen.getByDisplayValue("customer_name"), {
      target: { value: "customer_label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply rename" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo last batch" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'ALTER TABLE "orders" RENAME COLUMN "customer_label" TO "customer_name"',
      );
    });

    expect(screen.getByText("Undid the last rename batch.")).toBeInTheDocument();
  });
});
