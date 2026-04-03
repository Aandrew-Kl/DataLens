import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy, Trash2 } from "lucide-react";

import Dropdown from "@/components/ui/dropdown";

describe("Dropdown", () => {
  it("does not render the menu until the trigger is activated", () => {
    render(
      <Dropdown
        trigger={<span>Actions</span>}
        items={[{ label: "Copy", icon: Copy, onClick: jest.fn() }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the menu, renders separators, and invokes an enabled item", async () => {
    const user = userEvent.setup();
    const onCopy = jest.fn();

    render(
      <Dropdown
        trigger={<span>Actions</span>}
        items={[
          { label: "Copy", icon: Copy, onClick: onCopy },
          { type: "separator" },
          { label: "Delete", icon: Trash2, onClick: jest.fn(), danger: true },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("does not invoke disabled items and closes on outside click", async () => {
    const user = userEvent.setup();
    const onArchive = jest.fn();

    render(
      <Dropdown
        trigger={<span>More</span>}
        items={[
          { label: "Archive", onClick: onArchive, disabled: true },
          { label: "Delete", icon: Trash2, onClick: jest.fn(), danger: true },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(onArchive).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("supports keyboard opening, navigation, and selection", async () => {
    const onCopy = jest.fn();

    render(
      <Dropdown
        trigger={<span>Keyboard</span>}
        items={[
          { label: "Copy", onClick: onCopy },
          { label: "Delete", onClick: jest.fn(), danger: true },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Keyboard" });

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
