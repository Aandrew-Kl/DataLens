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
  it("formats values above one million using M suffix", () => {
    expect(formatNumber(1_500_000)).toBe("1.5M");
    expect(formatNumber(-2_500_000)).toBe("-2.5M");
    expect(formatNumber(999_500_000_000_000)).toBe("999500000.0M");
  });

  it("formats values between one thousand and one million using K suffix", () => {
    expect(formatNumber(1_500)).toBe("1.5K");
    expect(formatNumber(-2_500)).toBe("-2.5K");
  });

  it("formats small integers and decimals", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(3.14159)).toBe("3.14");
    expect(formatNumber(-0.5)).toBe("-0.50");
  });

  it("throws for non-numeric inputs", () => {
    expect(() => formatNumber(null as unknown as number)).toThrow();
    expect(() => formatNumber(undefined as unknown as number)).toThrow();
  });
});

describe("formatBytes", () => {
  it("formats zero and standard byte units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512.0 B");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(1_048_576)).toBe("1.0 MB");
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
  });

  it("formats very large values above gigabytes", () => {
    expect(formatBytes(900 * Math.pow(1024, 3))).toBe("900.0 GB");
  });
});

describe("generateId", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses mocked time/random inputs for deterministic output", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    jest.spyOn(Math, "random").mockReturnValue(0.123456789);

    expect(generateId()).toBe(
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    );
  });

  it("changes with different random values", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const randomSpy = jest
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.111111)
      .mockReturnValueOnce(0.222222);

    expect(generateId()).not.toBe(generateId());
    expect(randomSpy).toHaveBeenCalledTimes(2);
  });
});

describe("getFileExtension", () => {
  it("normalizes extensions to lowercase", () => {
    expect(getFileExtension("report.CSV")).toBe("csv");
    expect(getFileExtension("archive.tar.Gz")).toBe("gz");
  });

  it("handles empty and special filenames", () => {
    expect(getFileExtension("README")).toBe("readme");
    expect(getFileExtension(".gitignore")).toBe("gitignore");
    expect(getFileExtension("file.")).toBe("");
    expect(getFileExtension("")).toBe("");
  });

  it("throws for non-string inputs", () => {
    expect(() => getFileExtension(null as unknown as string)).toThrow();
    expect(() => getFileExtension(undefined as unknown as string)).toThrow();
  });
});

describe("sanitizeTableName", () => {
  it("removes extension and normalizes characters", () => {
    expect(sanitizeTableName("Sales Report-2024.csv")).toBe(
      "Sales_Report_2024",
    );
    expect(sanitizeTableName("A&B#(c)@d")).toBe("A_B__c__d");
  });

  it("collapses leading and trailing underscores and enforces length", () => {
    expect(sanitizeTableName("__orders___.xlsx")).toBe("orders");
    expect(sanitizeTableName(`${"a".repeat(80)}.csv`)).toHaveLength(50);
  });

  it("falls back to data when everything is stripped", () => {
    expect(sanitizeTableName("..."))
      .toBe("data");
    expect(sanitizeTableName("***")).toBe("data");
  });

  it("throws for null and undefined", () => {
    expect(() => sanitizeTableName(null as unknown as string)).toThrow();
    expect(() => sanitizeTableName(undefined as unknown as string)).toThrow();
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(new Date("2025-01-31T12:00:00Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns human-friendly labels for recent times", () => {
    const now = Date.now();

    expect(formatRelativeTime(now - 30_000)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000)).toBe("5m ago");
    expect(formatRelativeTime(now - 2 * 60 * 60_000)).toBe("2h ago");
    expect(formatRelativeTime(now - 36 * 60 * 60_000)).toBe("yesterday");
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000)).toBe("3d ago");
    expect(formatRelativeTime(now - 14 * 24 * 60 * 60_000)).toBe("2w ago");
  });

  it("falls back to locale date for old timestamps", () => {
    const timestamp = new Date("2024-11-15T10:00:00Z").getTime();
    expect(formatRelativeTime(timestamp)).toBe(new Date(timestamp).toLocaleDateString());
  });
});

describe("formatDuration", () => {
  it("handles millisecond and second boundaries", () => {
    expect(formatDuration(0.5)).toBe("<1ms");
    expect(formatDuration(-20)).toBe("<1ms");
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(1_000)).toBe("1.0s");
    expect(formatDuration(59_000)).toBe("59.0s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});

describe("truncate", () => {
  it("returns original strings that fit", () => {
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("", 10)).toBe("");
  });

  it("truncates with a unicode ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("hello", 1)).toBe("…");
  });

  it("throws on invalid input", () => {
    expect(() => truncate(null as unknown as string, 3)).toThrow();
    expect(() => truncate(undefined as unknown as string, 3)).toThrow();
  });
});

describe("pluralize", () => {
  it("chooses singular only for one", () => {
    expect(pluralize(1, "row")).toBe("row");
  });

  it("falls back to regular plural form", () => {
    expect(pluralize(0, "row")).toBe("rows");
    expect(pluralize(2, "row")).toBe("rows");
  });

  it("supports custom plural forms", () => {
    expect(pluralize(2, "index", "indices")).toBe("indices");
  });
});

describe("formatPercent", () => {
  it("formats with default precision", () => {
    expect(formatPercent(95.123)).toBe("95.1%");
    expect(formatPercent(95.123, 2)).toBe("95.12%");
    expect(formatPercent(95.123, 0)).toBe("95%");
  });
});

describe("clamp", () => {
  it("keeps values inside bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps out-of-range values", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("supports reversed bounds by constraining to max", () => {
    expect(clamp(99, 7, 7)).toBe(7);
    expect(clamp(99, 100, 10)).toBe(10);
  });
});
