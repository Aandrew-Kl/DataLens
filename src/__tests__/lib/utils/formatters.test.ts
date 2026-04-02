import {
  clamp,
  formatBytes,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  generateId,
  getFileExtension,
  pluralize,
  sanitizeTableName,
  truncate,
} from "@/lib/utils/formatters";

describe("formatNumber", () => {
  it("formats large values with compact suffixes", () => {
    expect(formatNumber(1_500_000)).toBe("1.5M");
    expect(formatNumber(-2_500)).toBe("-2.5K");
    expect(formatNumber(1_000)).toBe("1.0K");
  });

  it("formats integers and decimals without suffixes when below one thousand", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(3.14159)).toBe("3.14");
    expect(formatNumber(-0.5)).toBe("-0.50");
  });
});

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats byte, kilobyte, megabyte, and gigabyte values", () => {
    expect(formatBytes(512)).toBe("512.0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1_048_576)).toBe("1.0 MB");
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
  });
});

describe("generateId", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("combines the current timestamp and random suffix", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    jest.spyOn(Math, "random").mockReturnValue(0.123456789);

    expect(generateId()).toBe(
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    );
  });

  it("produces different values across calls when the random portion changes", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const randomSpy = jest
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.111111)
      .mockReturnValueOnce(0.222222);

    const first = generateId();
    const second = generateId();

    expect(first).not.toBe(second);
    expect(randomSpy).toHaveBeenCalledTimes(2);
  });
});

describe("getFileExtension", () => {
  it("returns the lowercased extension for normal filenames", () => {
    expect(getFileExtension("report.CSV")).toBe("csv");
    expect(getFileExtension("archive.tar.gz")).toBe("gz");
  });

  it("returns the full filename when there is no dot", () => {
    expect(getFileExtension("README")).toBe("readme");
  });

  it("handles hidden files and trailing dots", () => {
    expect(getFileExtension(".gitignore")).toBe("gitignore");
    expect(getFileExtension("file.")).toBe("");
  });
});

describe("sanitizeTableName", () => {
  it("removes the file extension and normalizes separators", () => {
    expect(sanitizeTableName("Sales Report-2024.csv")).toBe(
      "Sales_Report_2024",
    );
  });

  it("trims leading and trailing underscores", () => {
    expect(sanitizeTableName("__orders___.xlsx")).toBe("orders");
  });

  it("limits table names to fifty characters", () => {
    expect(sanitizeTableName(`${"a".repeat(80)}.csv`)).toHaveLength(50);
  });

  it("falls back to data when normalization removes everything", () => {
    expect(sanitizeTableName("...")).toBe("data");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(
      new Date("2025-01-31T12:00:00Z").valueOf(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("formats recent timestamps using relative labels", () => {
    const now = Date.now();

    expect(formatRelativeTime(now - 30_000)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000)).toBe("5m ago");
    expect(formatRelativeTime(now - 2 * 60 * 60_000)).toBe("2h ago");
    expect(formatRelativeTime(now - 36 * 60 * 60_000)).toBe("yesterday");
  });

  it("formats day and week ranges", () => {
    const now = Date.now();

    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000)).toBe("3d ago");
    expect(formatRelativeTime(now - 14 * 24 * 60 * 60_000)).toBe("2w ago");
  });

  it("falls back to a locale date for older timestamps", () => {
    const timestamp = new Date("2024-11-15T10:00:00Z").valueOf();

    expect(formatRelativeTime(timestamp)).toBe(
      new Date(timestamp).toLocaleDateString(),
    );
  });
});

describe("formatDuration", () => {
  it("formats sub-millisecond, millisecond, second, and minute durations", () => {
    expect(formatDuration(0.5)).toBe("<1ms");
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(1_000)).toBe("1.0s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});

describe("truncate", () => {
  it("returns strings unchanged when they fit", () => {
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long strings with an ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w\u2026");
    expect(truncate("hello", 1)).toBe("\u2026");
  });
});

describe("pluralize", () => {
  it("returns the singular form only for one", () => {
    expect(pluralize(1, "row")).toBe("row");
  });

  it("returns the default or custom plural for all other counts", () => {
    expect(pluralize(0, "row")).toBe("rows");
    expect(pluralize(5, "row")).toBe("rows");
    expect(pluralize(2, "index", "indices")).toBe("indices");
  });
});

describe("formatPercent", () => {
  it("formats percentages with the requested precision", () => {
    expect(formatPercent(95.123)).toBe("95.1%");
    expect(formatPercent(95.123, 2)).toBe("95.12%");
    expect(formatPercent(95.123, 0)).toBe("95%");
  });
});

describe("clamp", () => {
  it("keeps values inside the provided range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps values below the minimum and above the maximum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns the bound when min and max are equal", () => {
    expect(clamp(99, 7, 7)).toBe(7);
  });
});
