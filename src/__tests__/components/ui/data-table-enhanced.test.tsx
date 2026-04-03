import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataTableEnhanced, {
  type DataTableBulkAction,
  type DataTableEnhancedColumn,
} from "@/components/ui/data-table-enhanced";

interface RevenueRow {
  name: string;
  revenue: number;
  region: string;
}

const rows: RevenueRow[] = [
  { name: "Gamma", revenue: 900, region: "South" },
  { name: "Alpha", revenue: 300, region: "North" },
  { name: "Beta", revenue: 120, region: "West" },
];

const columns: DataTableEnhancedColumn<RevenueRow>[] = [
  {
    id: "name",
    header: "Name",
    accessor: (row) => row.name,
  },
  {
    id: "revenue",
    header: "Revenue",
    accessor: (row) => row.revenue,
    align: "right",
    width: 180,
  },
  {
    id: "region",
    header: "Region",
    accessor: (row) => row.region,
  },
];

describe("DataTableEnhanced", () => {
  it("renders the first page and supports column resize plus pagination", async () => {
    const user = userEvent.setup();

    render(<DataTableEnhanced data={rows} columns={columns} title="Revenue report" initialPageSize={2} />);

    expect(screen.getByText("Revenue report")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Resize Revenue column" }), {
      clientX: 200,
    });
    fireEvent.mouseMove(window, { clientX: 260 });
    fireEvent.mouseUp(window);

    expect(screen.getByText("Revenue").closest("th")).toHaveStyle({ width: "240px" });

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("sorts rows when a sortable header is clicked repeatedly", async () => {
    const user = userEvent.setup();

    render(<DataTableEnhanced data={rows} columns={columns} initialPageSize={5} />);

    await user.click(screen.getByRole("button", { name: "Revenue" }));
    let bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent("Beta");

    await user.click(screen.getByRole("button", { name: "Revenue" }));
    bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent("Gamma");
  });

  it("filters to an empty state when no rows match", async () => {
    const user = userEvent.setup();

    render(<DataTableEnhanced data={rows} columns={columns} initialPageSize={5} />);

    await user.type(screen.getByRole("textbox", { name: "Filter rows" }), "zzz");

    expect(screen.getByText("No rows match the current filters.")).toBeInTheDocument();
  });

  it("shows the bulk toolbar and exports selected rows", async () => {
    const user = userEvent.setup();
    const onExportSelected = jest.fn();
    const onArchive = jest.fn();
    const bulkActions: DataTableBulkAction<RevenueRow>[] = [
      {
        label: "Archive",
        onClick: onArchive,
      },
    ];

    render(
      <DataTableEnhanced
        data={rows}
        columns={columns}
        initialPageSize={5}
        bulkActions={bulkActions}
        onExportSelected={onExportSelected}
      />,
    );

    await user.click(screen.getByLabelText("Select row 1"));
    await user.click(screen.getByLabelText("Select row 2"));

    expect(screen.getByText("2 rows selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledWith([rows[0], rows[1]]);

    await user.click(screen.getByRole("button", { name: "Export selected" }));
    expect(onExportSelected).toHaveBeenCalledWith([rows[0], rows[1]]);
  });
});
