import Papa from "papaparse";
import { parseCSV, parseCSVFromText } from "@/lib/parsers/csv-parser";

jest.mock("papaparse", () => ({
  parse: jest.fn(),
}));

const mockPapaParse = Papa.parse as jest.Mock;

class MockFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  readAsText(file: Blob): void {
    void file;
    this.onload?.({
      target: {
        result: "a,b\n1,2",
      },
    });
  }
}

describe("csv-parser", () => {
  const file = new Blob(["a,b\n1,2"], { type: "text/csv" }) as unknown as File;

  beforeEach(() => {
    mockPapaParse.mockReset();
    mockPapaParse.mockReturnValue({
      errors: [],
      data: [{ a: "1" }],
      meta: { delimiter: ",", linebreak: "\n", aborted: false, truncated: false, cursor: 0 },
    });
    global.FileReader = MockFileReader as unknown as typeof FileReader;
  });

  it("parseCSVFromText returns array of objects", () => {
    expect(parseCSVFromText("a,b\n1,2")).toEqual([{ a: "1" }]);
  });

  it("parseCSV resolves with text content", async () => {
    await expect(parseCSV(file)).resolves.toBe("a,b\n1,2");
  });

  it("parseCSV rejects on invalid CSV (errors with no data)", async () => {
    mockPapaParse.mockReturnValue({
      errors: [{ message: "invalid", type: "FieldMismatch", code: "TooFewFields", row: 0 }],
      data: [],
      meta: { delimiter: ",", linebreak: "\n", aborted: false, truncated: false, cursor: 0 },
    });

    await expect(parseCSV(file)).rejects.toThrow("Invalid CSV file");
  });
});
