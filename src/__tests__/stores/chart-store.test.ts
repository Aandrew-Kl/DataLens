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
    useChartStore.setState({
      savedCharts: [],
      activeChartId: null,
      chartHistory: [],
    });
    jest.restoreAllMocks();
  });

  it("adds a chart, stamps timestamps, and clones mutable fields", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const sourceColumns = ["month", "revenue"];
    const sourceOptions = { palette: ["#0f172a"] };
    const input = makeChart({
      id: "",
      columns: sourceColumns,
      options: sourceOptions,
    });

    useChartStore.getState().addChart(input);

    sourceColumns.push("profit");
    sourceOptions.palette.push("#10b981");

    const state = useChartStore.getState();
    const saved = state.savedCharts[0];

    expect(saved).toMatchObject({
      type: "bar",
      title: "Revenue by Month",
      columns: ["month", "revenue"],
      options: { palette: ["#0f172a"] },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    expect(saved.id).toMatch(/^chart_/);
    expect(state.activeChartId).toBe(saved.id);
    expect(state.chartHistory[0]).toEqual(saved);
  });

  it("removes the active chart and falls back to the next saved chart", () => {
    useChartStore.getState().addChart(makeChart({ id: "chart-a", title: "Chart A" }));
    useChartStore.getState().addChart(makeChart({ id: "chart-b", title: "Chart B" }));

    useChartStore.getState().removeChart("chart-b");

    const state = useChartStore.getState();

    expect(state.savedCharts.map((chart) => chart.id)).toEqual(["chart-a"]);
    expect(state.activeChartId).toBe("chart-a");
    expect(state.chartHistory[0]?.id).toBe("chart-b");
  });

  it("updates a chart, preserves its identity, and stores the previous snapshot in history", () => {
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
    Object.assign(patchOptions, { tooltip: { trigger: "axis" } });

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
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it("duplicates a chart with a new id and a copy suffix in the title", () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(100).mockReturnValueOnce(200);

    useChartStore.getState().addChart(makeChart({ id: "chart-1", title: "Bookings" }));

    useChartStore.getState().duplicateChart("chart-1");

    const state = useChartStore.getState();
    const duplicated = state.savedCharts[0];
    const original = state.savedCharts[1];

    expect(state.savedCharts).toHaveLength(2);
    expect(duplicated.id).not.toBe(original.id);
    expect(duplicated.title).toBe("Bookings Copy");
    expect(duplicated.columns).toEqual(original.columns);
    expect(duplicated.options).toEqual(original.options);
    expect(duplicated.createdAt).toBe(200);
    expect(state.activeChartId).toBe(duplicated.id);
    expect(state.chartHistory[0]?.id).toBe(duplicated.id);
  });

  it("reorders charts and ignores invalid reorder requests", () => {
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
    expect(useChartStore.getState().savedCharts.map((chart) => chart.id)).toEqual([
      "chart-b",
      "chart-a",
      "chart-c",
    ]);
  });

  it("clears all saved charts and history", () => {
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
