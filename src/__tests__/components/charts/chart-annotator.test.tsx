import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChartAnnotator from "@/components/charts/chart-annotator";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
    ) => {
      const [value, setValue] = actual.useState(getSnapshot);
      actual.useEffect(() => subscribe(() => setValue(getSnapshot())), [subscribe, getSnapshot]);
      return value;
    },
  };
});

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const getDataURLMock = jest.fn(() => "data:image/png;base64,annotated");

jest.mock("echarts-for-react", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<{ getEchartsInstance: () => { getDataURL: typeof getDataURLMock } }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: getDataURLMock,
        }),
      }));

      return React.createElement("div", {
        "data-testid": "echart",
        "data-option": JSON.stringify(props.option ?? null),
      });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B", "C"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20, 30],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [2, 4, 6],
  },
];

describe("ChartAnnotator", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([
      { x_value: "A", y_value: 10 },
      { x_value: "B", y_value: 20 },
    ]);
    getDataURLMock.mockClear();
    window.localStorage.clear();
  });

  it("loads chart data from DuckDB", async () => {
    const user = userEvent.setup();

    render(<ChartAnnotator tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Load chart" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM "orders"'),
      );
      expect(
        screen.getByText("Chart data loaded from DuckDB."),
      ).toBeInTheDocument();
    });
  });

  it("saves a text annotation and persists it locally", async () => {
    const user = userEvent.setup();

    render(<ChartAnnotator tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("Label"), {
      target: { value: "Goal" },
    });
    fireEvent.change(screen.getByPlaceholderText("X value"), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByPlaceholderText("Y value"), {
      target: { value: "25" },
    });
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("Annotation saved.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    const savedAnnotations = JSON.parse(
      window.localStorage.getItem("datalens:chart-annotations:orders") ?? "[]",
    ) as Array<Record<string, unknown>>;

    expect(savedAnnotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Goal",
          kind: "text",
          xValue: "A",
          yValue: "25",
        }),
      ]),
    );
  });

  it("edits an existing annotation", async () => {
    window.localStorage.setItem(
      "datalens:chart-annotations:orders",
      JSON.stringify([
        {
          id: "annotation-1",
          chartKey: "line:category:sales:SUM",
          kind: "text",
          label: "Target",
          color: "#06b6d4",
          createdAt: 1,
          xValue: "A",
          yValue: "10",
        },
      ]),
    );

    const user = userEvent.setup();
    render(<ChartAnnotator tableName="orders" columns={columns} />);

    const card = screen.getByText("Target").closest("article");
    expect(card).not.toBeNull();

    const actionButtons = within(card as HTMLElement).getAllByRole("button");
    await user.click(actionButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Label")).toHaveValue("Target");
    });

    const labelInput = screen.getByPlaceholderText("Label");
    fireEvent.change(labelInput, { target: { value: "Updated target" } });
    expect(labelInput).toHaveValue("Updated target");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(screen.getByText("Annotation updated.")).toBeInTheDocument();
    });

    const updatedAnnotations = JSON.parse(
      window.localStorage.getItem("datalens:chart-annotations:orders") ?? "[]",
    ) as Array<Record<string, unknown>>;
    expect(updatedAnnotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "annotation-1",
          label: "Updated target",
        }),
      ]),
    );
  });

  it("deletes an existing annotation", async () => {
    window.localStorage.setItem(
      "datalens:chart-annotations:orders",
      JSON.stringify([
        {
          id: "annotation-1",
          chartKey: "line:category:sales:SUM",
          kind: "text",
          label: "Target",
          color: "#06b6d4",
          createdAt: 1,
          xValue: "A",
          yValue: "10",
        },
      ]),
    );

    const user = userEvent.setup();
    render(<ChartAnnotator tableName="orders" columns={columns} />);

    const updatedCard = screen.getByText("Target").closest("article");
    expect(updatedCard).not.toBeNull();
    const updatedButtons = within(updatedCard as HTMLElement).getAllByRole("button");
    await user.click(updatedButtons[1]);

    await waitFor(() => {
      expect(screen.getByText("Annotation deleted.")).toBeInTheDocument();
    });

    expect(window.localStorage.getItem("datalens:chart-annotations:orders")).toBe("[]");
  });

  it("exports a PNG from the rendered chart instance", async () => {
    const user = userEvent.setup();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<ChartAnnotator tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Export PNG" }));

    expect(getDataURLMock).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("shows query failures from DuckDB", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockRejectedValueOnce(new Error("Annotation preview failed"));

    render(<ChartAnnotator tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Load chart" }));

    await waitFor(() => {
      expect(screen.getByText("Annotation preview failed")).toBeInTheDocument();
    });
  });
});
