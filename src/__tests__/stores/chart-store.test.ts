import { useChartStore, type SavedChartConfig } from "@/stores/chart-store";

type DraftChart = Omit<SavedChartConfig, "createdAt" | "updatedAt">;

function makeChart(overrides: Partial<DraftChart> = {}): DraftChart {
  return {
    id: "chart-1",
    type: "bar",
    title: "Revenue by Month",
    xAxis: "month",
    yAxis: "revenue",
    aggregation: "sum",
    columns: ["month", "revenue"],
    options: {
      stacked: false,
      palette: ["#0f172a", "#38bdf8"],
    },
    ...overrides,
  };
}

describe("useChartStore", () => {
  beforeEach(() => {
    useChartStore.setState(useChartStore.getInitialState());
    jest.restoreAllMocks();
  });

  it("has correct initial state", () => {
    const state = useChartStore.getState();

    expect(state.savedCharts).toEqual([]);
    expect(state.activeChartId).toBeNull();
    expect(state.chartHistory).toEqual([]);
  });

  it("adds a chart with generated id when not provided and stores cloned data", () => {
    const now = 1_700_000_000_000;
    const sourceColumns = ["month", "revenue"];
    const sourceOptions = { palette: ["#0f172a"] };
    const chart = makeChart({
      id: "",
      columns: sourceColumns,
      options: sourceOptions,
    });

    jest.spyOn(Date, "now").mockReturnValue(now);

    useChartStore.getState().addChart(chart);

    sourceColumns.push("profit");
    sourceOptions.palette.push("#10b981");

    const state = useChartStore.getState();
    const saved = state.savedCharts[0];

    expect(state.activeChartId).toBe(saved.id);
    expect(saved.id).toMatch(/^chart_/);
    expect(saved.columns).toEqual(["month", "revenue"]);
    expect(saved.options).toEqual({ palette: ["#0f172a"] });
    expect(saved.createdAt).toBe(now);
    expect(saved.updatedAt).toBe(now);
    expect(state.chartHistory[0]).toEqual(saved);
  });

  it("keeps provided chart id when supplied", () => {
    useChartStore.getState().addChart(makeChart({ id: "provided-id" }));

    expect(useChartStore.getState().savedCharts[0]?.id).toBe("provided-id");
    expect(useChartStore.getState().activeChartId).toBe("provided-id");
  });

  it("removes a chart and falls back active chart id", () => {
    useChartStore.getState().addChart(makeChart({ id: "chart-a", title: "A" }));
    useChartStore.getState().addChart(makeChart({ id: "chart-b", title: "B" }));

    useChartStore.getState().removeChart("chart-b");

    const state = useChartStore.getState();
    expect(state.savedCharts.map((chart) => chart.id)).toEqual(["chart-a"]);
    expect(state.activeChartId).toBe("chart-a");
    expect(state.chartHistory[0]?.id).toBe("chart-b");
  });

  it("does nothing when removing a non-existing chart", () => {
    useChartStore.getState().addChart(makeChart({ id: "chart-a" }));

    useChartStore.getState().removeChart("missing");

    expect(useChartStore.getState().savedCharts.map((chart) => chart.id)).toEqual([
      "chart-a",
    ]);
    expect(useChartStore.getState().activeChartId).toBe("chart-a");
  });

  it("updates a chart and pushes previous version into history", () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(100).mockReturnValueOnce(250);

    useChartStore.getState().addChart(makeChart({ id: "chart-1", title: "Original" }));

    const patchColumns = ["region"];
    const patchOptions = { legend: { show: true } };
    useChartStore.getState().updateChart("chart-1", {
      title: "Updated",
      columns: patchColumns,
      options: patchOptions,
    });

    patchColumns.push("profit");
    patchOptions.legend.show = false;

    const state = useChartStore.getState();
    const saved = state.savedCharts[0];

    expect(saved).toMatchObject({
      id: "chart-1",
      title: "Updated",
      columns: ["region"],
      options: { legend: { show: true } },
      createdAt: 100,
      updatedAt: 250,
    });
    expect(state.activeChartId).toBe("chart-1");
    expect(state.chartHistory[0]).toMatchObject({
      id: "chart-1",
      title: "Original",
      columns: ["month", "revenue"],
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it("does not update state when attempting to update missing chart", () => {
    useChartStore.getState().addChart(makeChart({ id: "chart-1" }));

    useChartStore.getState().updateChart("missing", {
      title: "Never",
    });

    const stored = useChartStore.getState().savedCharts;
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("chart-1");
    expect(stored[0].title).toBe("Revenue by Month");
  });

  it("duplicates a chart and generates a new id", () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(100).mockReturnValueOnce(200);

    useChartStore.getState().addChart(makeChart({ id: "chart-1", title: "Original" }));
    useChartStore.getState().duplicateChart("chart-1");

    const state = useChartStore.getState();
    const duplicated = state.savedCharts[0];
    const original = state.savedCharts[1];

    expect(duplicated).toMatchObject({
      id: expect.any(String),
      title: "Original Copy",
      columns: original.columns,
      options: original.options,
      createdAt: 200,
      updatedAt: 200,
    });
    expect(duplicated.id).not.toBe(original.id);
    expect(state.activeChartId).toBe(duplicated.id);
    expect(state.chartHistory[0]?.id).toBe(duplicated.id);
  });

  it("does nothing when duplicating a missing chart", () => {
    useChartStore.getState().addChart(makeChart({ id: "chart-1" }));

    useChartStore.getState().duplicateChart("missing");

    expect(useChartStore.getState().savedCharts).toEqual([
      expect.objectContaining({ id: "chart-1" }),
    ]);
  });

  it("reorders charts when indices are valid and ignores invalid reorder requests", () => {
    useChartStore.getState().addChart(makeChart({ id: "chart-a", title: "A" }));
    useChartStore.getState().addChart(makeChart({ id: "chart-b", title: "B" }));
    useChartStore.getState().addChart(makeChart({ id: "chart-c", title: "C" }));

    useChartStore.getState().reorderCharts(0, 2);
    expect(useChartStore.getState().savedCharts.map((chart) => chart.id)).toEqual([
      "chart-b",
      "chart-a",
      "chart-c",
    ]);

    useChartStore.getState().reorderCharts(-1, 1);
    useChartStore.getState().reorderCharts(1, 3);
    expect(useChartStore.getState().savedCharts.map((chart) => chart.id)).toEqual([
      "chart-b",
      "chart-a",
      "chart-c",
    ]);
  });

  it("keeps query history bounded to ten entries", () => {
    for (let index = 0; index < 11; index += 1) {
      useChartStore.getState().addChart(makeChart({ id: `chart-${index}` }));
    }

    const state = useChartStore.getState();

    expect(state.chartHistory).toHaveLength(10);
    expect(state.chartHistory[0]?.id).toBe("chart-10");
    expect(state.chartHistory[9]?.id).toBe("chart-1");
  });

  it("clears charts and history", () => {
    useChartStore.getState().addChart(makeChart({ id: "chart-a" }));
    useChartStore.getState().addChart(makeChart({ id: "chart-b" }));

    useChartStore.getState().clearAll();

    expect(useChartStore.getState()).toMatchObject({
      savedCharts: [],
      activeChartId: null,
      chartHistory: [],
    });
  });
});
