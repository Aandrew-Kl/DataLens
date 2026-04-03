import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatasetSidebar from "@/components/layout/dataset-sidebar";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

const columns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 1,
    uniqueCount: 4,
    sampleValues: ["West", "East"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DatasetSidebar tableName="orders" columns={columns} />);
  });
}

describe("DatasetSidebar", () => {
  it("renders the table node and its columns", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", { level: 2, name: "Dataset sidebar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getAllByText("created_at").length).toBeGreaterThan(0);
    expect(screen.getAllByText("revenue").length).toBeGreaterThan(0);
  });

  it("filters the visible columns with the search input", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.type(screen.getByLabelText("Search columns"), "rev");

    expect(screen.getAllByText("revenue").length).toBeGreaterThan(0);
    expect(screen.queryByText("region")).not.toBeInTheDocument();
  });

  it("updates the selected column details and supports collapse", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: /revenue/i }));

    expect(screen.getAllByText("revenue").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /orders/i }));
    expect(screen.queryByRole("button", { name: /created_at/i })).not.toBeInTheDocument();
  });
});
