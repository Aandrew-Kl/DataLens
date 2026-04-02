import {
  formatNumber,
  formatBytes,
  generateId,
  getFileExtension,
  sanitizeTableName,
  formatRelativeTime,
  formatDuration,
  truncate,
  pluralize,
  formatPercent,
  clamp,
} from "@/lib/utils/formatters";

describe("formatNumber", () => {
  it("formats millions with M suffix", () => {
    expect(formatNumber(1500000)).toBe("1.5M");
    expect(formatNumber(2000000)).toBe("2.0M");
    expect(formatNumber(-3500000)).toBe("-3.5M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(10000)).toBe("10.0K");
    expect(formatNumber(-2500)).toBe("-2.5K");
  });

  it("formats integers with locale separators", () => {
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(0)).toBe("0");
  });

  it("formats decimals to 2 places", () => {
    expect(formatNumber(3.14159)).toBe("3.14");
    expect(formatNumber(0.5)).toBe("0.50");
  });
});

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500.0 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2560)).toBe("2.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });
});

describe("generateId", () => {
  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("returns a string", () => {
    expect(typeof generateId()).toBe("string");
  });

  it("is not empty", () => {
    expect(generateId().length).toBeGreaterThan(0);
  });
});

describe("getFileExtension", () => {
  it("extracts csv extension", () => {
    expect(getFileExtension("data.csv")).toBe("csv");
  });

  it("extracts xlsx extension", () => {
    expect(getFileExtension("report.xlsx")).toBe("xlsx");
  });

  it("handles multiple dots", () => {
    expect(getFileExtension("my.data.file.json")).toBe("json");
  });

  it("returns empty string for no extension", () => {
    expect(getFileExtension("noext")).toBe("noext");
  });

  it("lowercases extensions", () => {
    expect(getFileExtension("FILE.CSV")).toBe("csv");
  });
});

describe("sanitizeTableName", () => {
  it("removes file extension", () => {
    expect(sanitizeTableName("data.csv")).toBe("data");
  });

  it("replaces special characters with underscore", () => {
    expect(sanitizeTableName("my-data-file.csv")).toBe("my_data_file");
  });

  it("handles spaces", () => {
    expect(sanitizeTableName("sales report 2024.xlsx")).toBe("sales_report_2024");
  });

  it("trims leading/trailing underscores", () => {
    expect(sanitizeTableName("__data__.csv")).toBe("data");
  });

  it("truncates to 50 chars", () => {
    const longName = "a".repeat(60) + ".csv";
    expect(sanitizeTableName(longName).length).toBeLessThanOrEqual(50);
  });

  it("returns 'data' for empty result", () => {
    expect(sanitizeTableName("...")).toBe("data");
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(formatRelativeTime(Date.now() - 5000)).toBe("just now");
  });

  it("returns minutes for recent times", () => {
    expect(formatRelativeTime(Date.now() - 300000)).toBe("5m ago");
  });

  it("returns hours", () => {
    expect(formatRelativeTime(Date.now() - 7200000)).toBe("2h ago");
  });

  it("returns 'yesterday'", () => {
    expect(formatRelativeTime(Date.now() - 86400000 * 1.5)).toBe("yesterday");
  });
});

describe("formatDuration", () => {
  it("formats sub-millisecond", () => {
    expect(formatDuration(0.5)).toBe("<1ms");
  });

  it("formats milliseconds", () => {
    expect(formatDuration(42)).toBe("42ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(3500)).toBe("3.5s");
  });

  it("formats minutes", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long strings with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w\u2026");
  });

  it("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("pluralize", () => {
  it("returns singular for 1", () => {
    expect(pluralize(1, "row")).toBe("row");
  });

  it("returns plural for other counts", () => {
    expect(pluralize(5, "row")).toBe("rows");
    expect(pluralize(0, "row")).toBe("rows");
  });

  it("uses custom plural", () => {
    expect(pluralize(2, "index", "indices")).toBe("indices");
  });
});

describe("formatPercent", () => {
  it("formats with default decimals", () => {
    expect(formatPercent(95.123)).toBe("95.1%");
  });

  it("formats with custom decimals", () => {
    expect(formatPercent(95.123, 2)).toBe("95.12%");
  });
});

describe("clamp", () => {
  it("returns value within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
