import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ConditionalFormatter from "@/components/data/conditional-formatter";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["late", "paid"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ConditionalFormatter tableName="invoices" columns={columns} />);
  });

  await waitFor(() => {
    expect(screen.getByTestId("cell-0-status")).toBeInTheDocument();
  });
}

describe("ConditionalFormatter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunQuery.mockResolvedValue([
      { status: "late", amount: 30 },
      { status: "paid", amount: 20 },
    ]);
  });

  it("renders preview rows from DuckDB", async () => {
    await renderAsync();

    expect(screen.getByText("late")).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("applies a matching formatting rule to preview cells", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Comparison value"), {
        target: { value: "late" },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-status")).toHaveClass("bg-cyan-500/15");
    });
  });

  it("reorders rules so a higher-priority style wins", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Comparison value"), {
        target: { value: "late" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    });

    const valueInputs = screen.getAllByPlaceholderText("Comparison value");
    const styleSelects = screen.getAllByDisplayValue("highlight");

    await act(async () => {
      fireEvent.change(valueInputs[1] as HTMLInputElement, {
        target: { value: "late" },
      });
      fireEvent.change(styleSelects[1] as HTMLSelectElement, {
        target: { value: "danger" },
      });
    });

    const upButtons = screen.getAllByRole("button", { name: "" }).filter((button) =>
      button.querySelector("svg"),
    );

    await act(async () => {
      fireEvent.click(upButtons[2] as HTMLButtonElement);
    });

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-status")).toHaveClass("bg-rose-500/15");
    });
  });
});
