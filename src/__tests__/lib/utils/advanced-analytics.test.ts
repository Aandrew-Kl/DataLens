import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  isRecord,
  normalPdf,
  normalQuantile,
  quoteIdentifier,
  quoteLiteral,
  toCount,
  toDate,
  toIsoDate,
  toNumber,
} from "@/lib/utils/advanced-analytics";

describe("advanced-analytics utilities", () => {
  it("exposes the expected animation tuple and shared class tokens", () => {
    expect(ANALYTICS_EASE).toEqual([0.22, 1, 0.36, 1]);
    expect(GLASS_PANEL_CLASS).toContain("backdrop-blur-2xl");
    expect(GLASS_CARD_CLASS).toContain("rounded-3xl");
    expect(FIELD_CLASS).toContain("focus:ring-4");
    expect(BUTTON_CLASS).toContain("disabled:opacity-50");
  });

  it("quotes SQL identifiers and literals by escaping embedded quotes", () => {
    expect(quoteIdentifier('sales"2024')).toBe('"sales""2024"');
    expect(quoteLiteral("O'Reilly")).toBe("'O''Reilly'");
  });

  it("converts unknown values into numbers and non-negative counts", () => {
    expect(toNumber(12)).toBe(12);
    expect(toNumber(BigInt(7))).toBe(7);
    expect(toNumber(" 3.5 ")).toBe(3.5);
    expect(toNumber("abc")).toBeNull();

    expect(toCount("2.6")).toBe(3);
    expect(toCount("-2.6")).toBe(0);
    expect(toCount(null)).toBe(0);
  });

  it("parses dates and normalizes them to ISO date strings", () => {
    const parsed = toDate("2024-01-02T03:04:05.000Z");

    expect(parsed).toEqual(new Date("2024-01-02T03:04:05.000Z"));
    expect(toIsoDate("2024-01-02T03:04:05.000Z")).toBe("2024-01-02");
    expect(toDate("not-a-date")).toBeNull();
    expect(toIsoDate("not-a-date")).toBeNull();
  });

  it("detects record-like values and decodes base64 data URLs", () => {
    expect(isRecord({ key: "value" })).toBe(true);
    expect(isRecord([1, 2, 3])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("text")).toBe(false);

    const decoded = dataUrlToBytes("data:text/plain;base64,SGk=");

    expect(decoded.mimeType).toBe("text/plain");
    expect(Array.from(decoded.bytes)).toEqual([72, 105]);
  });

  it("computes normal density values and approximate quantiles", () => {
    expect(normalPdf(0, 0, 1)).toBeCloseTo(0.3989422804, 10);
    expect(normalPdf(0, 0, 0)).toBe(0);
    expect(normalPdf(Number.NaN, 0, 1)).toBe(0);

    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.95996, 3);
    expect(normalQuantile(0)).toBeLessThan(-4);
    expect(normalQuantile(1)).toBeGreaterThan(4);
  });
});
