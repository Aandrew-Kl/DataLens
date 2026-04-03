import {
  clearMetrics,
  getPerformanceReport,
  measureQuery,
  measureRender,
} from "@/lib/utils/performance-monitor";

interface MockPerformanceApi extends Performance {
  clearMarks: (markName?: string) => void;
  clearMeasures: (measureName?: string) => void;
  getEntriesByName: (name: string, type?: string) => PerformanceEntryList;
  mark: (
    markName: string,
    markOptions?: PerformanceMarkOptions,
  ) => PerformanceMark;
  measure: (
    measureName: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ) => PerformanceMeasure;
}

const originalPerformanceApi: Partial<MockPerformanceApi> = {
  clearMarks: (performance as Partial<MockPerformanceApi>).clearMarks,
  clearMeasures: (performance as Partial<MockPerformanceApi>).clearMeasures,
  getEntriesByName: (performance as Partial<MockPerformanceApi>).getEntriesByName,
  mark: (performance as Partial<MockPerformanceApi>).mark,
  measure: (performance as Partial<MockPerformanceApi>).measure,
};

function createPerformanceEntry(
  name: string,
  duration: number,
  entryType: string,
): PerformanceEntry {
  return {
    name,
    entryType,
    startTime: 0,
    duration,
    toJSON: () => ({
      name,
      entryType,
      startTime: 0,
      duration,
    }),
  };
}

function installMockPerformanceApi(
  durationResolver: (name: string) => number,
): void {
  const performanceApi = performance as MockPerformanceApi;

  performanceApi.mark = jest.fn((name: string) => {
    return createPerformanceEntry(name, 0, "mark") as PerformanceMark;
  });
  performanceApi.measure = jest.fn((name: string) => {
    return createPerformanceEntry(
      name,
      durationResolver(name),
      "measure",
    ) as PerformanceMeasure;
  });
  performanceApi.getEntriesByName = jest.fn((name: string, type?: string) => {
    if (type !== "measure") {
      return [];
    }

    return [createPerformanceEntry(name, durationResolver(name), "measure")];
  });
  performanceApi.clearMarks = jest.fn();
  performanceApi.clearMeasures = jest.fn();
}

function restorePerformanceApi(): void {
  const performanceApi = performance as Partial<MockPerformanceApi> &
    Record<string, unknown>;

  if (originalPerformanceApi.mark) {
    performanceApi.mark = originalPerformanceApi.mark;
  } else {
    delete performanceApi.mark;
  }

  if (originalPerformanceApi.measure) {
    performanceApi.measure = originalPerformanceApi.measure;
  } else {
    delete performanceApi.measure;
  }

  if (originalPerformanceApi.getEntriesByName) {
    performanceApi.getEntriesByName = originalPerformanceApi.getEntriesByName;
  } else {
    delete performanceApi.getEntriesByName;
  }

  if (originalPerformanceApi.clearMarks) {
    performanceApi.clearMarks = originalPerformanceApi.clearMarks;
  } else {
    delete performanceApi.clearMarks;
  }

  if (originalPerformanceApi.clearMeasures) {
    performanceApi.clearMeasures = originalPerformanceApi.clearMeasures;
  } else {
    delete performanceApi.clearMeasures;
  }
}

function removePerformanceApi(): void {
  const performanceApi = performance as Partial<MockPerformanceApi> &
    Record<string, unknown>;

  delete performanceApi.mark;
  delete performanceApi.measure;
  delete performanceApi.getEntriesByName;
  delete performanceApi.clearMarks;
  delete performanceApi.clearMeasures;
}

describe("performance-monitor", () => {
  beforeEach(() => {
    clearMetrics();
    jest.restoreAllMocks();
    restorePerformanceApi();
  });

  afterAll(() => {
    restorePerformanceApi();
  });

  it("records render and query metrics and aggregates them into a report", async () => {
    installMockPerformanceApi((name) => (name.includes("render") ? 12.5 : 45.25));

    const renderMeasurement = measureRender("VirtualDataGrid");
    renderMeasurement.start();
    renderMeasurement.end();

    const queryResult = await measureQuery("load-orders", async () => "done");

    expect(queryResult).toEqual({
      result: "done",
      durationMs: 45.25,
    });
    expect(getPerformanceReport()).toEqual({
      renders: [
        expect.objectContaining({
          component: "VirtualDataGrid",
          durationMs: 12.5,
        }),
      ],
      queries: [
        expect.objectContaining({
          label: "load-orders",
          durationMs: 45.25,
        }),
      ],
      totalRenders: 1,
      avgRenderMs: 12.5,
      totalQueries: 1,
      avgQueryMs: 45.25,
    });
  });

  it("records rejected queries before rethrowing the error", async () => {
    installMockPerformanceApi(() => 9);
    const error = new Error("Query failed");

    await expect(
      measureQuery("failing-query", async () => {
        throw error;
      }),
    ).rejects.toThrow("Query failed");

    expect(getPerformanceReport()).toMatchObject({
      totalQueries: 1,
      avgQueryMs: 9,
      queries: [
        expect.objectContaining({
          label: "failing-query",
          durationMs: 9,
        }),
      ],
    });
  });

  it("clears all collected metrics", async () => {
    installMockPerformanceApi(() => 5);

    const renderMeasurement = measureRender("Grid");
    renderMeasurement.start();
    renderMeasurement.end();
    await measureQuery("query", async () => ({ ok: true }));

    clearMetrics();

    expect(getPerformanceReport()).toEqual({
      renders: [],
      queries: [],
      totalRenders: 0,
      avgRenderMs: 0,
      totalQueries: 0,
      avgQueryMs: 0,
    });
  });

  it("falls back safely when the Performance API is unavailable", async () => {
    removePerformanceApi();

    const nowSpy = jest
      .spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_050)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_090);

    try {
      const renderMeasurement = measureRender("SSRGrid");
      renderMeasurement.start();
      renderMeasurement.end();

      const queryResult = await measureQuery("ssr-query", async () => "ok");

      expect(queryResult).toEqual({
        result: "ok",
        durationMs: 90,
      });
      expect(getPerformanceReport()).toEqual({
        renders: [
          expect.objectContaining({
            component: "SSRGrid",
            durationMs: 50,
          }),
        ],
        queries: [
          expect.objectContaining({
            label: "ssr-query",
            durationMs: 90,
          }),
        ],
        totalRenders: 1,
        avgRenderMs: 50,
        totalQueries: 1,
        avgQueryMs: 90,
      });
    } finally {
      restorePerformanceApi();
      nowSpy.mockRestore();
    }
  });

  it("handles end without start gracefully", () => {
    const renderMeasurement = measureRender("NoStart");
    renderMeasurement.end();

    expect(getPerformanceReport()).toMatchObject({
      totalRenders: 0,
    });
  });
});
