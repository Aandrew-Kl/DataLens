/**
 * Data export utilities.
 *
 * Provides helpers to export an array of row objects to CSV, JSON, or the
 * clipboard (as tab-separated values). All browser-download helpers work by
 * creating a temporary `<a>` element with an Object URL, which is revoked
 * after the download is initiated.
 */

/**
 * Escape a single cell value for inclusion in a CSV file.
 *
 * Wraps the value in double-quotes when it contains commas, double-quotes,
 * or newlines. Internal double-quotes are escaped by doubling them (`""`).
 */
function escapeCSVCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const str = String(value);

  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Collect the union of all keys across every row so that sparsely-populated
 * objects still produce a complete header row.
 */
function collectHeaders(data: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const headers: string[] = [];

  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  return headers;
}

/**
 * Create a temporary download for an in-memory string.
 *
 * @param content  - The file body.
 * @param filename - Suggested file name (with extension).
 * @param mimeType - MIME type for the Blob, e.g. `"text/csv"`.
 */
export function downloadFile(
  content: BlobPart | BlobPart[],
  filename: string,
  mimeType: string,
): void {
  const parts = Array.isArray(content) ? content : [content];
  const blob = new Blob(parts, { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();

  // Clean up after a short delay to give the browser time to start the download.
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Export an array of row objects as a CSV file and trigger a browser download.
 *
 * @param data     - The rows to export.
 * @param filename - Suggested file name (should end with `.csv`).
 */
export function exportToCSV(
  data: Record<string, unknown>[],
  filename: string,
): void {
  if (data.length === 0) return;

  const headers = collectHeaders(data);

  const headerLine = headers.map(escapeCSVCell).join(",");
  const bodyLines = data.map((row) =>
    headers.map((h) => escapeCSVCell(row[h])).join(","),
  );

  const csv = [headerLine, ...bodyLines].join("\n");
  downloadFile(csv, filename, "text/csv;charset=utf-8;");
}

/**
 * Export an array of row objects as a JSON file and trigger a browser download.
 *
 * @param data     - The rows to export.
 * @param filename - Suggested file name (should end with `.json`).
 */
export function exportToJSON(
  data: Record<string, unknown>[],
  filename: string,
): void {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, filename, "application/json;charset=utf-8;");
}

/**
 * Copy the data to the clipboard as tab-separated values (suitable for
 * pasting into spreadsheets).
 *
 * @param data - The rows to copy.
 * @returns A promise that resolves once the data is on the clipboard.
 */
export async function exportToClipboard(
  data: Record<string, unknown>[],
): Promise<void> {
  if (data.length === 0) return;

  const headers = collectHeaders(data);

  const headerLine = headers.join("\t");
  const bodyLines = data.map((row) =>
    headers
      .map((h) => {
        const v = row[h];
        if (v === null || v === undefined) return "";
        // Replace tabs and newlines so they don't break the TSV structure.
        return String(v).replace(/[\t\n\r]/g, " ");
      })
      .join("\t"),
  );

  const tsv = [headerLine, ...bodyLines].join("\n");
  await navigator.clipboard.writeText(tsv);
}
