import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import GlassTabs from "@/components/ui/glass-tabs";

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const motion = new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        React.forwardRef(function MockMotion(
          props: Record<string, unknown>,
          ref: React.ForwardedRef<HTMLElement>,
        ) {
          const {
            animate,
            children,
            exit,
            initial,
            layout,
            layoutId,
            transition,
            whileHover,
            whileTap,
            ...rest
          } = props;
          void animate;
          void exit;
          void initial;
          void layout;
          void layoutId;
          void transition;
          void whileHover;
          void whileTap;
          return React.createElement(
            String(prop),
            { ...rest, ref },
            children as React.ReactNode,
          );
        }),
    },
  );

  return {
    __esModule: true,
    motion,
  };
});

const tabs = [
  { id: "overview", label: "Overview", content: <div>Overview panel</div> },
  { id: "details", label: "Details", content: <div>Details panel</div> },
  { id: "history", label: "History", content: <div>History panel</div> },
];

async function renderAsync(
  props: Partial<React.ComponentProps<typeof GlassTabs>> = {},
) {
  await act(async () => {
    render(<GlassTabs tabs={tabs} {...props} />);
  });
}

describe("GlassTabs", () => {
  it("renders the default tab and lazily mounts panels", async () => {
    await renderAsync({ defaultTab: "overview" });

    expect(screen.getByText("Overview panel")).toBeInTheDocument();
    expect(screen.queryByText("Details panel")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation between tabs", async () => {
    await renderAsync({ defaultTab: "overview" });

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });

    expect(screen.getByText("Details panel")).toBeInTheDocument();
  });

  it("supports controlled mode through the activeTab prop", async () => {
    const onTabChange = jest.fn();

    await renderAsync({
      activeTab: "overview",
      onTabChange,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    expect(onTabChange).toHaveBeenCalledWith("details");
    expect(screen.getByText("Overview panel")).toBeInTheDocument();
  });
});
