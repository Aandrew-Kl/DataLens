import { fireEvent, render, screen } from "@testing-library/react";

import {
  useKeyboardNavigation,
  type UseKeyboardNavigationOptions,
} from "@/hooks/use-keyboard-navigation";

interface GridHarnessProps extends UseKeyboardNavigationOptions {}

function GridHarness(props: GridHarnessProps) {
  const navigation = useKeyboardNavigation(props);

  return (
    <div>
      <button onClick={() => navigation.setActive(10, 10)}>Set far cell</button>
      <div
        data-testid="grid"
        {...navigation.containerProps}
      >
        {Array.from({ length: props.rows }, (_, row) => (
          <div
            key={`row-${row}`}
            role="row"
          >
            {Array.from({ length: props.cols }, (_, col) => {
              const cellProps = navigation.getCellProps(row, col);
              return (
                <div
                  key={`${row}-${col}`}
                  data-testid={`cell-${row}-${col}`}
                  {...cellProps}
                >
                  {row},{col}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <output data-testid="active">
        {navigation.activeRow},{navigation.activeCol}
      </output>
    </div>
  );
}

describe("useKeyboardNavigation", () => {
  it("moves through the grid with arrows and Home/End", () => {
    render(
      <GridHarness
        rows={3}
        cols={4}
      />,
    );

    const grid = screen.getByTestId("grid");

    expect(grid).toHaveAttribute("aria-activedescendant", expect.stringContaining("0-0"));
    expect(screen.getByTestId("cell-0-0")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(screen.getByTestId("active")).toHaveTextContent("0,1");

    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(screen.getByTestId("active")).toHaveTextContent("1,1");

    fireEvent.keyDown(grid, { key: "End" });
    expect(screen.getByTestId("active")).toHaveTextContent("1,3");

    fireEvent.keyDown(grid, { key: "Home" });
    expect(screen.getByTestId("active")).toHaveTextContent("1,0");

    fireEvent.click(screen.getByRole("button", { name: "Set far cell" }));
    expect(screen.getByTestId("active")).toHaveTextContent("2,3");
  });

  it("wraps around edges when wrapping is enabled", () => {
    render(
      <GridHarness
        rows={2}
        cols={2}
        wrap
      />,
    );

    const grid = screen.getByTestId("grid");

    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(screen.getByTestId("active")).toHaveTextContent("0,1");

    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(screen.getByTestId("active")).toHaveTextContent("1,1");
  });

  it("invokes selection handlers for Enter and Space", () => {
    const onSelect = jest.fn();

    render(
      <GridHarness
        rows={2}
        cols={2}
        onSelect={onSelect}
      />,
    );

    const grid = screen.getByTestId("grid");

    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(grid, { key: " " });

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, 1, 1);
    expect(onSelect).toHaveBeenNthCalledWith(2, 1, 1);
  });

  it("invokes the escape handler", () => {
    const onEscape = jest.fn();

    render(
      <GridHarness
        rows={2}
        cols={2}
        onEscape={onEscape}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("grid"), { key: "Escape" });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
