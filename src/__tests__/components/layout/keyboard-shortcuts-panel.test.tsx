import { act, fireEvent, render, screen } from "@testing-library/react";
import KeyboardShortcutsPanel from "@/components/layout/keyboard-shortcuts-panel";
import type { ColumnProfile } from "@/types/dataset";

const columns: ColumnProfile[] = [
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
    render(<KeyboardShortcutsPanel tableName="orders" columns={columns} />);
  });
}

describe("KeyboardShortcutsPanel", () => {
  it("renders the grouped shortcut overlay", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Work faster inside the orders workspace",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Datasets")).toBeInTheDocument();
  });

  it("filters shortcuts by the search text", async () => {
    await renderAsync();
    const searchInput = screen.getByLabelText("Search shortcuts");
    fireEvent.change(searchInput, { target: { value: "export" } });

    expect(
      await screen.findByText("Open export actions for the active report or dataset."),
    ).toBeInTheDocument();
    expect(searchInput).toHaveValue("export");
  });

  it("closes the overlay when Escape is pressed", async () => {
    await renderAsync();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByRole("button", { name: "Open shortcuts" })).toBeInTheDocument();
  });
});
