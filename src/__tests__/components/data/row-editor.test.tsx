import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import RowEditor from "@/components/data/row-editor";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2],
    min: 1,
    max: 3,
    mean: 2,
    median: 2,
  },
  {
    name: "customer",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Ada", "Grace"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [10, 20],
    min: 10,
    max: 30,
    mean: 20,
    median: 20,
  },
];

async function renderAsync() {
  await act(async () => {
    render(<RowEditor tableName="orders" columns={columns} />);
  });
}

describe("RowEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads a row by index and populates editable fields", async () => {
    mockRunQuery.mockResolvedValueOnce([
      {
        __datalens_rowid: 7,
        id: 1,
        customer: "Ada",
        amount: 10,
      },
    ]);

    await renderAsync();
    fireEvent.click(screen.getByRole("button", { name: "Load row" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Edit customer")).toHaveValue("Ada");
      expect(screen.getByLabelText("Edit amount")).toHaveValue("10");
    });
  });

  it("validates cell input before saving", async () => {
    mockRunQuery.mockResolvedValueOnce([
      {
        __datalens_rowid: 7,
        id: 1,
        customer: "Ada",
        amount: 10,
      },
    ]);

    await renderAsync();
    fireEvent.click(screen.getByRole("button", { name: "Load row" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Edit amount")).toHaveValue("10");
    });

    fireEvent.change(screen.getByLabelText("Edit amount"), {
      target: { value: "oops" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("amount: Must be a valid number.")).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
  });

  it("saves row updates and undoes the last edit", async () => {
    mockRunQuery.mockResolvedValueOnce([
      {
        __datalens_rowid: 7,
        id: 1,
        customer: "Ada",
        amount: 10,
      },
    ]);
    mockRunQuery.mockResolvedValueOnce([]);
    mockRunQuery.mockResolvedValueOnce([]);

    await renderAsync();
    fireEvent.click(screen.getByRole("button", { name: "Load row" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Edit amount")).toHaveValue("10");
    });

    fireEvent.change(screen.getByLabelText("Edit amount"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'UPDATE "orders" SET "amount" = 25 WHERE rowid = 7',
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo last edit" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'UPDATE "orders" SET "amount" = 10 WHERE rowid = 7',
      );
    });
  });
});
