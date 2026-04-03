import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ColumnDetail from "@/components/data/column-detail";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);

describe("ColumnDetail", () => {
  let writeTextMock: jest.MockedFunction<(text: string) => Promise<void>>;

  beforeEach(() => {
    mockRunQuery.mockReset();
    writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  it("does not render when closed", () => {
    const column: ColumnProfile = {
      name: "revenue",
      type: "number",
      nullCount: 4,
      uniqueCount: 90,
      sampleValues: [10, 20],
      min: 10,
      max: 120,
      mean: 54,
      median: 50,
    };

    render(
      <ColumnDetail
        column={column}
        tableName="sales"
        onClose={jest.fn()}
        open={false}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders numeric statistics and histogram data", async () => {
    const column: ColumnProfile = {
      name: "revenue",
      type: "number",
      nullCount: 4,
      uniqueCount: 90,
      sampleValues: [10, 20],
      min: 10,
      max: 120,
      mean: 54,
      median: 50,
    };

    mockRunQuery
      .mockResolvedValueOnce([{ cnt: 100 }])
      .mockResolvedValueOnce([
        { lo: 10, hi: 20, cnt: 8 },
        { lo: 20, hi: 30, cnt: 12 },
      ]);

    render(
      <ColumnDetail
        column={column}
        tableName="sales"
        onClose={jest.fn()}
        open
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Column detail: revenue" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Completeness")).toBeInTheDocument();
    expect(screen.getByText("Histogram")).toBeInTheDocument();
    expect(screen.getByText("Unique Values")).toBeInTheDocument();
    expect(screen.getByText("10 - 20")).toBeInTheDocument();
    expect(screen.getByText("20 - 30")).toBeInTheDocument();
  });

  it("renders string sample values and top values", async () => {
    const column: ColumnProfile = {
      name: "region",
      type: "string",
      nullCount: 2,
      uniqueCount: 4,
      sampleValues: ["East", "West", "South"],
    };

    mockRunQuery
      .mockResolvedValueOnce([{ cnt: 50 }])
      .mockResolvedValueOnce([
        { val: "East", cnt: 20 },
        { val: "West", cnt: 15 },
      ]);

    render(
      <ColumnDetail
        column={column}
        tableName="sales"
        onClose={jest.fn()}
        open
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Sample Values")).toBeInTheDocument();
    });

    expect(screen.getAllByText("East").length).toBeGreaterThan(0);
    expect(screen.getAllByText("West").length).toBeGreaterThan(0);
    expect(screen.getByText("Top Values")).toBeInTheDocument();
  });

  it("copies quick actions and closes from Escape", async () => {
    const onClose = jest.fn();
    const column: ColumnProfile = {
      name: "region",
      type: "string",
      nullCount: 2,
      uniqueCount: 4,
      sampleValues: ["East", "West"],
    };

    mockRunQuery
      .mockResolvedValueOnce([{ cnt: 50 }])
      .mockResolvedValueOnce([{ val: "East", cnt: 20 }]);

    render(
      <ColumnDetail
        column={column}
        tableName="sales"
        onClose={onClose}
        open
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Filter by this column" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        'SELECT * FROM "sales" WHERE "region" = \'\';',
      );
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
