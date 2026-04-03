import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import GlassModal from "@/components/ui/glass-modal";

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
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion,
  };
});

async function renderAsync(open = true, onClose = jest.fn()) {
  await act(async () => {
    render(
      <GlassModal
        open={open}
        onClose={onClose}
        title="Filters"
        description="Preview and confirm"
        footer={<button type="button">Apply</button>}
      >
        <div>Modal body</div>
      </GlassModal>,
    );
  });

  return onClose;
}

describe("GlassModal", () => {
  it("does not render when closed", async () => {
    await renderAsync(false);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title, body, footer, and locks page scrolling", async () => {
    await renderAsync(true);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Modal body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes from Escape, the close button, and overlay clicks", async () => {
    const onClose = await renderAsync(true, jest.fn());

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getByTestId("glass-modal-overlay"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(3);
    });
  });
});
