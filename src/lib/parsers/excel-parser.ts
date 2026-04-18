interface ExcelCellLike {
  value: unknown;
}

interface ExcelRowLike {
  getCell(index: number): ExcelCellLike;
}

interface ExcelWorksheetLike {
  actualColumnCount?: number;
  columnCount?: number;
  rowCount: number;
  getRow(index: number): ExcelRowLike;
}

function escapeCsvCell(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function stringifyExcelValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if ("result" in value) {
      return stringifyExcelValue(value.result);
    }

    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? stringifyExcelValue(part.text)
            : ""
        )
        .join("");
    }

    if ("text" in value) {
      return stringifyExcelValue(value.text);
    }

    if ("hyperlink" in value) {
      return stringifyExcelValue(value.hyperlink);
    }

    if ("error" in value) {
      return stringifyExcelValue(value.error);
    }
  }

  return String(value);
}

function worksheetToCsv(worksheet: ExcelWorksheetLike): string {
  const width = Math.max(
    worksheet.actualColumnCount ?? 0,
    worksheet.columnCount ?? 0,
  );

  if (worksheet.rowCount === 0 || width === 0) {
    throw new Error("Workbook does not contain tabular data.");
  }

  const lines: string[] = [];

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const cells = Array.from({ length: width }, (_, index) =>
      stringifyExcelValue(row.getCell(index + 1).value),
    );

    if (cells.every((cell) => cell === "")) {
      continue;
    }

    lines.push(cells.map(escapeCsvCell).join(","));
  }

  if (lines.length === 0) {
    throw new Error("Workbook does not contain tabular data.");
  }

  return lines.join("\n");
}

export async function parseExcel(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".xls")) {
    throw new Error(
      "Legacy .xls spreadsheets are not supported for in-browser parsing. Convert the file to .xlsx or CSV."
    );
  }

  try {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const data = await file.arrayBuffer();
    await workbook.xlsx.load(data);

    const worksheet = workbook.worksheets[0] as ExcelWorksheetLike | undefined;
    if (!worksheet) {
      throw new Error("Workbook does not contain any worksheets.");
    }

    return worksheetToCsv(worksheet);
  } catch (error) {
    throw new Error(`Failed to parse Excel: ${error}`);
  }
}
