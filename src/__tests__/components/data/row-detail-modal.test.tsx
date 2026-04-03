import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RowDetailModal from "@/components/data/row-detail-modal";
import type { ColumnProfile } from "@/types/dataset";

const columns: ColumnProfile[] = [
  {
    name: "name",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Ada"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1234],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["2024-01-01"],
  },
  {
    name: "active",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true],
  },
  {
    name: "meta",
    type: "unknown",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [],
  },
  {
    name: "notes",
    type: "string",
    nullCount: 1,
    uniqueCount: 4,
    sampleValues: [null],
  },
];

const row: Record<string, unknown> = {
  name: "Ada",
  revenue: 1234,
  created_at: "2024-01-01T12:30:00Z",
  active: true,
  meta: { plan: "pro" },
  notes: null,
};

describe("RowDetailModal", () => {
  let mockWriteText: jest.MockedFunction<(text: string) => Promise<void>>;

  beforeEach(() => {
    mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mockWriteText },
    });
  });

  it("does not render anything when closed", () => {
    render(
      <RowDetailModal
        open={false}
        onClose={jest.fn()}
        row={row}
        columns={columns}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders row fields, values, and navigation metadata", async () => {
    const user = userEvent.setup();
    void user;

    render(
      <RowDetailModal
        open
        onClose={jest.fn()}
        row={row}
        columns={columns}
        rowIndex={1}
        totalRows={10}
        hasPrevious
        hasNext
        onPrevious={jest.fn()}
        onNext={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Row 2 of 10")).toBeInTheDocument();
      expect(screen.getByText("Record snapshot")).toBeInTheDocument();
      expect(screen.getByText("name")).toBeInTheDocument();
      expect(screen.getByText("Ada")).toBeInTheDocument();
      expect(screen.getByText("1.2K")).toBeInTheDocument();
      expect(screen.getByText("true")).toBeInTheDocument();
      expect(screen.getByText("null")).toBeInTheDocument();
      expect(screen.getByText("6 fields")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });
  });

  it("copies the row JSON to the clipboard", async () => {
    const user = userEvent.setup();

    render(
      <RowDetailModal
        open
        onClose={jest.fn()}
        row={row}
        columns={columns}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy row JSON" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    });
  });

  it("closes from the backdrop and the close button", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(
      <RowDetailModal
        open
        onClose={onClose}
        row={row}
        columns={columns}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close row details" }));
    await user.click(screen.getByRole("button", { name: "Close modal" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  it("supports keyboard navigation and escape dismissal", async () => {
    const user = userEvent.setup();
    void user;

    const onClose = jest.fn();
    const onPrevious = jest.fn();
    const onNext = jest.fn();

    render(
      <RowDetailModal
        open
        onClose={onClose}
        row={row}
        columns={columns}
        onPrevious={onPrevious}
        onNext={onNext}
        hasPrevious
        hasNext
      />,
    );

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(onPrevious).toHaveBeenCalledTimes(1);
      expect(onNext).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
