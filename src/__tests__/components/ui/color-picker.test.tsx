import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColorPicker from "@/components/ui/color-picker";

describe("ColorPicker", () => {
  it("renders the current color value in the trigger", () => {
    render(<ColorPicker defaultValue="#14B8A6" />);

    expect(screen.getByRole("button", { name: "#14B8A6" })).toBeInTheDocument();
  });

  it("applies a preset swatch selection", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(<ColorPicker defaultValue="#14B8A6" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "#14B8A6" }));
    await user.click(screen.getByRole("button", { name: "Pick #EF4444" }));

    expect(onChange).toHaveBeenLastCalledWith("#EF4444");
    expect(screen.getByRole("button", { name: "#EF4444" })).toBeInTheDocument();
  });

  it("normalizes custom hex input and stores it in the recent list", async () => {
    const user = userEvent.setup();

    render(<ColorPicker defaultValue="#14B8A6" />);

    await user.click(screen.getByRole("button", { name: "#14B8A6" }));
    await user.clear(screen.getByRole("textbox", { name: "Hex color" }));
    await user.type(screen.getByRole("textbox", { name: "Hex color" }), "abc");
    await user.click(screen.getByRole("button", { name: "Apply color" }));

    expect(screen.getByRole("button", { name: "#AABBCC" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "#AABBCC" }));
    expect(screen.getByText("Recent colors")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "#AABBCC" })).toHaveLength(2);
  });

  it("shows validation feedback for invalid hex input", async () => {
    const user = userEvent.setup();

    render(<ColorPicker defaultValue="#14B8A6" />);

    await user.click(screen.getByRole("button", { name: "#14B8A6" }));
    await user.clear(screen.getByRole("textbox", { name: "Hex color" }));
    await user.type(screen.getByRole("textbox", { name: "Hex color" }), "oops");

    expect(screen.getByText("Enter a valid 3 or 6 digit hex color.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply color" })).toBeDisabled();
  });
});
