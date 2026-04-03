import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DataGrid, { type DataGridColumn, type DataGridRow } from "@/components/ui/data-grid";

const columns: DataGridColumn[] = [
  { key: "name", label: "Name" },
  { key: "sales", label: "Sales", align: "right" },
];

const rows: DataGridRow[] = [
  { name: "Alpha", sales: 30 },
  { name: "Beta", sales: 10 },
  { name: "Gamma", sales: 20 },
];

async function renderAsync(props: Partial<React.ComponentProps<typeof DataGrid>> = {}) {
  await act(async () => {
    render(<DataGrid columns={columns} rows={rows} height={180} {...props} />);
  });
}

describe("DataGrid", () => {
  it("filters visible rows from the filter row", async () => {
    await renderAsync();

    fireEvent.change(screen.getByLabelText("Filter Name"), {
      target: { value: "Beta" },
    });

    await waitFor(() => {
      expect(screen.getByText("Beta")).toBeInTheDocument();
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    });
  });

  it("sorts rows when clicking a column header", async () => {
    await renderAsync();

    fireEvent.click(screen.getByRole("button", { name: "Sales" }));

    const rowElements = screen.getAllByRole("row");
    expect(rowElements[1]).toHaveTextContent("Beta");
  });

  it("virtualizes large datasets and supports keyboard row selection", async () => {
    const largeRows = Array.from({ length: 250 }, (_, index) => ({
      name: `Row ${index}`,
      sales: index,
    }));

    await renderAsync({ rows: largeRows, height: 120 });

    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.queryByText("Row 249")).not.toBeInTheDocument();

    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "Enter" });

    const rowElements = screen.getAllByRole("row");
    expect(rowElements[1]).toHaveAttribute("aria-selected", "true");
  });
});
