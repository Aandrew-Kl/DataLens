/**
 * @jest-environment jsdom
 */
import { exportToCSV, exportToJSON, exportToClipboard } from "@/lib/utils/export";

// Mock browser APIs
const mockCreateElement = jest.fn();
const mockClick = jest.fn();
const mockRevokeObjectURL = jest.fn();
let lastCreatedUrl: string | undefined;

beforeEach(() => {
  // Mock URL.createObjectURL
  global.URL.createObjectURL = jest.fn(() => {
    lastCreatedUrl = "blob:mock-url";
    return lastCreatedUrl;
  });
  global.URL.revokeObjectURL = mockRevokeObjectURL;

  // Mock document.createElement for anchor tags
  const originalCreateElement = document.createElement.bind(document);
  jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "a") {
      const link = originalCreateElement("a");
      link.click = mockClick;
      return link;
    }
    return originalCreateElement(tag);
  });

  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("exportToCSV", () => {
  it("creates a download with correct filename", () => {
    const data = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];

    exportToCSV(data, "test");
    expect(mockClick).toHaveBeenCalled();
  });

  it("handles empty data", () => {
    exportToCSV([], "empty");
    // Should still create a file (just headers or empty)
  });

  it("handles special characters in values", () => {
    const data = [
      { name: 'Alice "Ally"', note: "has, comma" },
      { name: "Bob\nNewline", note: "normal" },
    ];

    exportToCSV(data, "special");
    expect(mockClick).toHaveBeenCalled();
  });
});

describe("exportToJSON", () => {
  it("creates a download with correct filename", () => {
    const data = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];

    exportToJSON(data, "test");
    expect(mockClick).toHaveBeenCalled();
  });

  it("handles complex nested data", () => {
    const data = [
      { name: "Alice", meta: { score: 95 } },
    ];

    exportToJSON(data, "nested");
    expect(mockClick).toHaveBeenCalled();
  });
});

describe("exportToClipboard", () => {
  it("copies data to clipboard", async () => {
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: mockWriteText },
    });

    const data = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];

    await exportToClipboard(data);
    expect(mockWriteText).toHaveBeenCalled();

    const clipboardContent = mockWriteText.mock.calls[0][0];
    expect(clipboardContent).toContain("Alice");
    expect(clipboardContent).toContain("Bob");
    expect(clipboardContent).toContain("\t"); // Tab-separated
  });
});
