import { fireEvent, render, screen } from "@testing-library/react";

import { useVirtualScroll } from "@/hooks/use-virtual-scroll";

interface VirtualScrollHarnessProps {
  containerHeight: number;
  itemHeight: number;
  overscan?: number;
  scrollIndex?: number;
  totalItems: number;
}

function VirtualScrollHarness({
  totalItems,
  itemHeight,
  containerHeight,
  overscan,
  scrollIndex = 8,
}: VirtualScrollHarnessProps) {
  const virtualScroll = useVirtualScroll({
    totalItems,
    itemHeight,
    containerHeight,
    overscan,
  });

  return (
    <div>
      <button onClick={() => virtualScroll.scrollToIndex(scrollIndex)}>Scroll to index</button>
      <div
        data-testid="container"
        {...virtualScroll.containerProps}
      >
        <div
          data-testid="inner"
          {...virtualScroll.innerProps}
        >
          {virtualScroll.visibleItems.map((item) => (
            <div
              key={item.index}
              data-testid={`item-${item.index}`}
              style={{ top: item.offsetTop }}
            >
              {item.index}
            </div>
          ))}
        </div>
      </div>
      <output data-testid="visible-range">
        {virtualScroll.visibleItems.map((item) => item.index).join(",")}
      </output>
      <output data-testid="total-height">{virtualScroll.totalHeight}</output>
    </div>
  );
}

describe("useVirtualScroll", () => {
  it("calculates the initial visible items with overscan", () => {
    render(
      <VirtualScrollHarness
        totalItems={100}
        itemHeight={20}
        containerHeight={100}
        overscan={2}
      />,
    );

    expect(screen.getByTestId("total-height")).toHaveTextContent("2000");
    expect(screen.getByTestId("visible-range")).toHaveTextContent("0,1,2,3,4,5,6");
    expect(screen.getByTestId("item-6")).toHaveStyle({ top: "120px" });
  });

  it("updates the visible window when the container scrolls", () => {
    render(
      <VirtualScrollHarness
        totalItems={100}
        itemHeight={20}
        containerHeight={100}
        overscan={2}
      />,
    );

    const container = screen.getByTestId("container");
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 120,
    });

    fireEvent.scroll(container, {
      currentTarget: {
        scrollTop: 120,
      },
      target: {
        scrollTop: 120,
      },
    });

    expect(screen.getByTestId("visible-range")).toHaveTextContent("4,5,6,7,8,9,10,11");
  });

  it("scrolls to an index and recalculates the visible items", () => {
    render(
      <VirtualScrollHarness
        totalItems={50}
        itemHeight={10}
        containerHeight={40}
        overscan={1}
        scrollIndex={10}
      />,
    );

    const container = screen.getByTestId("container");
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: "Scroll to index" }));

    expect(container.scrollTop).toBe(100);
    expect(screen.getByTestId("visible-range")).toHaveTextContent("9,10,11,12,13,14");
  });
});
