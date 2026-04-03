import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TreeView, { type TreeNode } from "@/components/ui/tree-view";

interface FolderData {
  count: number;
}

const nodes: TreeNode<FolderData>[] = [
  {
    id: "customers",
    label: "Customers",
    children: [
      { id: "enterprise", label: "Enterprise" },
      { id: "smb", label: "SMB" },
    ],
  },
  {
    id: "orders",
    label: "Orders",
  },
];

describe("TreeView", () => {
  it("renders the search input and top-level nodes", () => {
    render(<TreeView nodes={nodes} />);

    expect(screen.getByRole("textbox", { name: "Search tree" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "Customers" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "Orders" })).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "Enterprise" })).not.toBeInTheDocument();
  });

  it("expands and collapses parent nodes from the toggle button", async () => {
    const user = userEvent.setup();

    render(<TreeView nodes={nodes} />);

    await user.click(screen.getByRole("button", { name: "Expand Customers" }));
    expect(screen.getByRole("treeitem", { name: "Enterprise" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "SMB" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse Customers" }));
    expect(screen.queryByRole("treeitem", { name: "Enterprise" })).not.toBeInTheDocument();
  });

  it("cascades checkbox selection to descendant nodes", async () => {
    const user = userEvent.setup();
    const onSelectionChange = jest.fn();

    render(<TreeView nodes={nodes} onSelectionChange={onSelectionChange} />);

    await user.click(screen.getByLabelText("Select Customers"));

    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "customers",
      "enterprise",
      "smb",
    ]);
  });

  it("filters matching nodes and supports keyboard navigation", async () => {
    const user = userEvent.setup();

    render(<TreeView nodes={nodes} defaultExpandedIds={["customers"]} />);

    const searchInput = screen.getByRole("textbox", { name: "Search tree" });
    await user.type(searchInput, "SMB");

    expect(screen.getByRole("treeitem", { name: "Customers" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "SMB" })).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "Orders" })).not.toBeInTheDocument();

    await user.clear(searchInput);

    const customers = screen.getByRole("treeitem", { name: "Customers" });
    fireEvent.focus(customers);
    fireEvent.keyDown(customers, { key: "ArrowDown" });

    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: "Enterprise" })).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByRole("treeitem", { name: "Enterprise" }), { key: " " });

    expect(screen.getByLabelText("Select Enterprise")).toBeChecked();
  });
});
