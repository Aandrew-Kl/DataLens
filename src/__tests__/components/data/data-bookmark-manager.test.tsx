import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import DataBookmarkManager from "@/components/data/data-bookmark-manager";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

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

const columns: ColumnProfile[] = [
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
    min: 10,
    max: 40,
    mean: 25,
    median: 25,
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataBookmarkManager tableName="orders" columns={columns} />);
  });
}

describe("DataBookmarkManager", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads saved bookmarks from localStorage", async () => {
    window.localStorage.setItem(
      "datalens:bookmark-manager:orders",
      JSON.stringify([
        {
          id: "saved-1",
          name: "Enterprise accounts",
          criteria: [
            {
              id: "criterion-1",
              column: "segment",
              operator: "=",
              value: "Enterprise",
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );

    await renderAsync();

    expect(screen.getByText("Enterprise accounts")).toBeInTheDocument();
    expect(screen.getByText("segment = Enterprise")).toBeInTheDocument();
  });

  it("saves a new bookmark and persists it", async () => {
    await renderAsync();

    fireEvent.change(screen.getByPlaceholderText("Top-value customers"), {
      target: { value: "High value" },
    });
    fireEvent.change(screen.getByPlaceholderText("Example value"), {
      target: { value: "Enterprise" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));

    expect(screen.getAllByText("High value").length).toBeGreaterThan(0);

    const raw = window.localStorage.getItem("datalens:bookmark-manager:orders");
    expect(raw).not.toBeNull();
    expect(raw).toContain("High value");
  });

  it("edits and deletes an existing bookmark", async () => {
    window.localStorage.setItem(
      "datalens:bookmark-manager:orders",
      JSON.stringify([
        {
          id: "saved-1",
          name: "Initial bookmark",
          criteria: [
            {
              id: "criterion-1",
              column: "segment",
              operator: "=",
              value: "Enterprise",
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );

    await renderAsync();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Top-value customers"), {
      target: { value: "Updated bookmark" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update bookmark" }));

    expect(screen.getAllByText("Updated bookmark").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("Updated bookmark")).not.toBeInTheDocument();
  });
});
