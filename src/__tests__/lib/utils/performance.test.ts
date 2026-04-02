import {
  createPerformanceTracker,
  formatDuration,
  measureQueryTime,
} from "@/lib/utils/performance";

function mockNowSequence(values: number[]) {
  return jest.spyOn(performance, "now").mockImplementation(() => {
    const value = values.shift();

    if (value === undefined) {
      throw new Error("No more mocked time values were provided.");
    }

    return value;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("measureQueryTime", () => {
  it("returns the resolved result together with the measured duration", async () => {
    const nowSpy = mockNowSequence([100, 145.5]);
    const query = jest.fn().mockResolvedValue({ rows: 10 });

    await expect(measureQueryTime(query)).resolves.toEqual({
      result: { rows: 10 },
      durationMs: 45.5,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(nowSpy).toHaveBeenCalledTimes(2);
  });

  it("propagates rejected operations without swallowing the error", async () => {
    mockNowSequence([50]);
    const error = new Error("Query failed");
    const query = jest.fn().mockRejectedValue(error);

    await expect(measureQueryTime(query)).rejects.toThrow("Query failed");
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("formatDuration", () => {
  it.each([
    [Number.NEGATIVE_INFINITY, "0ms"],
    [NaN, "0ms"],
    [-1, "0ms"],
    [0, "0ms"],
    [0.5, "<1ms"],
    [999.4, "999ms"],
    [1_000, "1.0s"],
    [9_999, "10.0s"],
    [10_000, "10s"],
    [60_000, "1m 0s"],
    [3_660_000, "1h 1m"],
  ])("formats %p as %p", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("createPerformanceTracker", () => {
  it("returns zeroed metrics before any operations complete", () => {
    const tracker = createPerformanceTracker();

    expect(tracker.getDuration()).toBe(0);
    expect(tracker.getDuration("missing")).toBe(0);
    expect(tracker.getMetrics()).toEqual({
      totalDurationMs: 0,
      completedOperations: 0,
      activeOperations: 0,
      operations: {},
    });
  });

  it("returns zero when ending an operation that was never started", () => {
    const tracker = createPerformanceTracker();

    expect(tracker.end("missing")).toBe(0);
  });

  it("tracks default operations and aggregates their statistics", () => {
    mockNowSequence([5, 20, 30, 50]);
    const tracker = createPerformanceTracker();

    tracker.start();
    expect(tracker.getMetrics().activeOperations).toBe(1);
    expect(tracker.end()).toBe(15);

    tracker.start();
    expect(tracker.end()).toBe(20);

    expect(tracker.getDuration("default")).toBe(20);
    expect(tracker.getDuration()).toBe(35);
    expect(tracker.getMetrics()).toEqual({
      totalDurationMs: 35,
      completedOperations: 2,
      activeOperations: 0,
      operations: {
        default: {
          count: 2,
          totalDurationMs: 35,
          averageDurationMs: 17.5,
          lastDurationMs: 20,
          minDurationMs: 15,
          maxDurationMs: 20,
        },
      },
    });
  });

  it("tracks named operations independently", () => {
    mockNowSequence([0, 10, 35, 50]);
    const tracker = createPerformanceTracker();

    tracker.start("query");
    tracker.start("render");

    expect(tracker.getMetrics().activeOperations).toBe(2);
    expect(tracker.end("query")).toBe(35);
    expect(tracker.end("render")).toBe(40);
    expect(tracker.getDuration("query")).toBe(35);
    expect(tracker.getDuration("render")).toBe(40);

    expect(tracker.getMetrics()).toMatchObject({
      totalDurationMs: 75,
      completedOperations: 2,
      activeOperations: 0,
      operations: {
        query: {
          count: 1,
          totalDurationMs: 35,
          averageDurationMs: 35,
          lastDurationMs: 35,
          minDurationMs: 35,
          maxDurationMs: 35,
        },
        render: {
          count: 1,
          totalDurationMs: 40,
          averageDurationMs: 40,
          lastDurationMs: 40,
          minDurationMs: 40,
          maxDurationMs: 40,
        },
      },
    });
  });

  it("uses LIFO ordering for nested starts of the same operation", () => {
    mockNowSequence([0, 5, 10, 20]);
    const tracker = createPerformanceTracker();

    tracker.start("query");
    tracker.start("query");

    expect(tracker.end("query")).toBe(5);
    expect(tracker.end("query")).toBe(20);
    expect(tracker.getDuration("query")).toBe(20);
    expect(tracker.getMetrics().operations.query).toEqual({
      count: 2,
      totalDurationMs: 25,
      averageDurationMs: 12.5,
      lastDurationMs: 20,
      minDurationMs: 5,
      maxDurationMs: 20,
    });
  });
});
