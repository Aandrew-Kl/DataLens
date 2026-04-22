/**
 * @jest-environment jsdom
 */
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

import * as exportUtils from "@/lib/utils/export";

const { downloadFile, exportToCSV, exportToJSON, exportToClipboard } = exportUtils;

if (typeof Blob.prototype.text !== "function") {
  Object.defineProperty(Blob.prototype, "text", {
    configurable: true,
    writable: true,
    value: function text(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}

let createObjectURLSpy: jest.SpyInstance;
let revokeObjectURLSpy: jest.SpyInstance;
let appendChildSpy: jest.SpyInstance;
let removeChildSpy: jest.SpyInstance;
let createElementSpy: jest.SpyInstance;
let anchor: HTMLAnchorElement;
let clickSpy: jest.Mock;
let originalCreateElement: typeof document.createElement;

beforeEach(() => {
  jest.useFakeTimers();

  createObjectURLSpy = jest
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:mock-url");
  createObjectURLSpy.mockClear();
  revokeObjectURLSpy = jest
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  revokeObjectURLSpy.mockClear();

  appendChildSpy = jest
    .spyOn(document.body, "appendChild")
    .mockImplementation((node: Node) => node);
  removeChildSpy = jest
    .spyOn(document.body, "removeChild")
    .mockImplementation((node: Node) => node);

  originalCreateElement = document.createElement.bind(document);
  anchor = originalCreateElement("a") as HTMLAnchorElement;
  clickSpy = jest.fn();
  jest.spyOn(anchor, "click").mockImplementation(clickSpy);

  createElementSpy = jest
    .spyOn(document, "createElement")
    .mockImplementation((tag: string) => {
      if (tag === "a") {
        return anchor;
      }
      return originalCreateElement(tag);
    });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("downloadFile", () => {
  it("creates a blob with requested mime type and triggers a click", () => {
    downloadFile("name,score\nAlice,10", "dataset.csv", "text/csv;charset=utf-8;");

    expect(createObjectURLSpy).toHaveBeenCalledWith(
      expect.any(Blob),
    );
    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const createdBlob = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(createdBlob).toBeInstanceOf(Blob);
    expect(createdBlob.type).toBe("text/csv;charset=utf-8;");
    expect(anchor.href).toBe("blob:mock-url");
    expect(anchor.download).toBe("dataset.csv");
    expect(anchor.style.display).toBe("none");
    expect(appendChildSpy).toHaveBeenCalledWith(anchor);

    jest.runOnlyPendingTimers();

    expect(removeChildSpy).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("exportToCSV", () => {
  it("formats headers, order, and escaped values", async () => {
    const data = [
      { name: "Alice", note: 'He said, "hello"', score: 10 },
      { score: 20, name: "Bob", region: "NA" },
    ];

    exportToCSV(data, "summary.csv");

    expect(createObjectURLSpy).toHaveBeenCalledWith(expect.any(Blob));

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8;");
    expect(anchor.download).toBe("summary.csv");
    expect(clickSpy).toHaveBeenCalled();

    const csv = await blob.text();

    expect(csv).toBe(
      "name,note,score,region\n" +
        'Alice,"He said, ""hello""",10,\n' +
        "Bob,,20,NA",
    );
  });

  it("does not trigger a download for empty data", () => {
    exportToCSV([], "empty.csv");
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });
});

describe("exportToJSON", () => {
  it("passes a pretty-printed JSON payload to downloadFile", async () => {
    const data = [{ name: "Alice", nested: { score: 10 } }, { name: "Bob" }];

    exportToJSON(data, "export.json");

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json;charset=utf-8;");

    const payload = await blob.text();
    expect(payload).toBe(JSON.stringify(data, null, 2));
    expect(anchor.download).toBe("export.json");
  });
});

describe("exportToClipboard", () => {
  it("writes TSV to clipboard and sanitizes tab/newline characters", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const data = [
      { name: "A\tB", notes: "line1\nline2" },
      { name: "C", notes: "ok" },
    ];

    await exportToClipboard(data);

    expect(writeText).toHaveBeenCalledTimes(1);
    const tsv = writeText.mock.calls[0][0] as string;

    expect(tsv).toBe("name\tnotes\nA B	line1 line2\nC\tok");
  });

  it("does not write to clipboard for empty data", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    await exportToClipboard([]);
    expect(writeText).not.toHaveBeenCalled();
  });
});
