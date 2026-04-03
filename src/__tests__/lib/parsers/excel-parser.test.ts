import * as XLSX from "xlsx";
import { parseExcel } from "../../../lib/parsers/excel-parser";

jest.mock("xlsx", () => ({
  read: jest.fn().mockReturnValue({
    SheetNames: ["Sheet1"],
    Sheets: { Sheet1: {} },
  }),
  utils: {
    sheet_to_csv: jest.fn().mockReturnValue("a,b\n1,2"),
  },
}));

class MockFileReader {
  onload: ((event: { target: { result: ArrayBuffer | null } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsArrayBuffer(_file: File): void {
    if (this.onload) {
      this.onload({ target: { result: new ArrayBuffer(8) } });
    }
  }
}

beforeAll(() => {
  (globalThis as unknown as { FileReader: typeof MockFileReader }).FileReader =
    MockFileReader;
});

describe("parseExcel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves with CSV string", async () => {
    const file = {} as unknown as File;
    await expect(parseExcel(file)).resolves.toBe("a,b\n1,2");
  });

  it("rejects when XLSX.read throws", async () => {
    (XLSX.read as jest.Mock).mockImplementation(() => {
      throw new Error("read failed");
    });

    const file = {} as unknown as File;
    await expect(parseExcel(file)).rejects.toThrow(
      "Failed to parse Excel: Error: read failed"
    );
  });
});
