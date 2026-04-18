import { parseExcel } from "../../../lib/parsers/excel-parser";

const load = jest.fn();
const workbook = {
  xlsx: {
    load,
  },
  worksheets: [
    {
      rowCount: 2,
      actualColumnCount: 2,
      getRow: (index: number) => ({
        getCell: (cellIndex: number) => {
          const values = [
            ["a", "b"],
            ["1", "2"],
          ];
          return { value: values[index - 1]?.[cellIndex - 1] ?? "" };
        },
      }),
    },
  ],
};
const Workbook = jest.fn(() => workbook);

jest.mock("exceljs", () => ({
  Workbook,
}));

function createFile(name = "report.xlsx") {
  return {
    name,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  } as unknown as File;
}

describe("parseExcel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    load.mockResolvedValue(undefined);
  });

  it("resolves with CSV string", async () => {
    const file = createFile();
    await expect(parseExcel(file)).resolves.toBe("a,b\n1,2");
  });

  it("rejects when workbook loading throws", async () => {
    load.mockRejectedValue(new Error("read failed"));

    const file = createFile();
    await expect(parseExcel(file)).rejects.toThrow(
      "Failed to parse Excel: Error: read failed"
    );
  });

  it("rejects legacy .xls uploads with a clear error", async () => {
    await expect(parseExcel(createFile("report.xls"))).rejects.toThrow(
      "Legacy .xls spreadsheets are not supported for in-browser parsing."
    );
  });
});
