import { quoteIdentifier } from "@/lib/utils/sql";
import { runQuery } from "@/lib/duckdb/client";

export interface ExportOptions {
  limit?: number;
  where?: string;
  orderBy?: string;
  includeHeaders?: boolean;
  prettyPrint?: boolean;
  tableName?: string;
}

type ExportFormat = "csv" | "json" | "sql" | "markdown" | "html";
function buildSelectQuery(
  tableName: string,
  columns: string[],
  options: ExportOptions,
) {
  const selectList =
    columns.length > 0 ? columns.map(quoteIdentifier).join(", ") : "*";
  const clauses = [`SELECT ${selectList} FROM ${quoteIdentifier(tableName)}`];

  if (options.where?.trim()) {
    clauses.push(`WHERE ${options.where.trim()}`);
  }

  if (options.orderBy?.trim()) {
    clauses.push(`ORDER BY ${options.orderBy.trim()}`);
  }

  if (typeof options.limit === "number" && options.limit > 0) {
    clauses.push(`LIMIT ${Math.floor(options.limit)}`);
  }

  return clauses.join(" ");
}

function collectHeaders(columns: string[], rows: Record<string, unknown>[]) {
  if (columns.length > 0) {
    return columns;
  }

  const seen = new Set<string>();
  const headers: string[] = [];

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  return headers;
}

function escapeCsvCell(value: unknown) {
  if (value == null) {
    return "";
  }

  const text = String(value);
  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function formatSqlLiteral(value: unknown) {
  if (value == null) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (value instanceof Date) {
    return `'${value.toISOString().replaceAll("'", "''")}'`;
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeMarkdownCell(value: unknown) {
  if (value == null) {
    return "";
  }

  return String(value)
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br />")
    .replaceAll("\r", "");
}

function escapeHtml(value: unknown) {
  if (value == null) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br />");
}

function rowsAsArrays(headers: string[], rows: Record<string, unknown>[]) {
  return rows.map((row) => headers.map((header) => row[header] ?? null));
}

function toCsv(headers: string[], rows: Record<string, unknown>[], includeHeaders: boolean) {
  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(headers.map(escapeCsvCell).join(","));
  }

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
  }

  return lines.join("\n");
}

function toJson(
  headers: string[],
  rows: Record<string, unknown>[],
  includeHeaders: boolean,
  prettyPrint: boolean,
) {
  const payload = includeHeaders ? rows : rowsAsArrays(headers, rows);
  return JSON.stringify(payload, null, prettyPrint ? 2 : 0);
}

function toSql(
  sourceTableName: string,
  headers: string[],
  rows: Record<string, unknown>[],
  targetTableName?: string,
) {
  const table = quoteIdentifier(targetTableName?.trim() || sourceTableName);
  const columnList = headers.map(quoteIdentifier).join(", ");

  if (rows.length === 0) {
    return `-- No rows matched the export query for ${table}`;
  }

  return rows
    .map((row) => {
      const values = headers.map((header) => formatSqlLiteral(row[header])).join(", ");
      return `INSERT INTO ${table} (${columnList}) VALUES (${values});`;
    })
    .join("\n");
}

function toMarkdown(
  headers: string[],
  rows: Record<string, unknown>[],
  includeHeaders: boolean,
) {
  if (!includeHeaders) {
    return rows
      .map((row) => `| ${headers.map((header) => escapeMarkdownCell(row[header])).join(" | ")} |`)
      .join("\n");
  }

  const headerRow = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const dividerRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyRows = rows.map(
    (row) => `| ${headers.map((header) => escapeMarkdownCell(row[header])).join(" | ")} |`,
  );

  return [headerRow, dividerRow, ...bodyRows].join("\n");
}

function toHtml(
  title: string,
  headers: string[],
  rows: Record<string, unknown>[],
  includeHeaders: boolean,
) {
  const headerMarkup = includeHeaders
    ? `<thead><tr>${headers
        .map((header) => `<th>${escapeHtml(header)}</th>`)
        .join("")}</tr></thead>`
    : "";

  const bodyMarkup = rows
    .map(
      (row) =>
        `<tr>${headers
          .map((header) => `<td>${escapeHtml(row[header])}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
        color: #0f172a;
        padding: 32px;
      }
      .card {
        max-width: 1200px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 24px;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
        overflow: hidden;
      }
      header { padding: 24px 28px; border-bottom: 1px solid rgba(148, 163, 184, 0.22); }
      h1 { margin: 0; font-size: 1.4rem; }
      p { margin: 8px 0 0; color: #475569; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid rgba(148, 163, 184, 0.18); vertical-align: top; }
      th { background: rgba(241, 245, 249, 0.8); font-size: 0.85rem; letter-spacing: 0.04em; text-transform: uppercase; }
      tr:nth-child(even) td { background: rgba(248, 250, 252, 0.72); }
    </style>
  </head>
  <body>
    <div class="card">
      <header>
        <h1>${escapeHtml(title)}</h1>
        <p>${rows.length.toLocaleString()} exported row${rows.length === 1 ? "" : "s"}</p>
      </header>
      <table>
        ${headerMarkup}
        <tbody>${bodyMarkup}</tbody>
      </table>
    </div>
  </body>
</html>`;
}

export async function exportToFormat(
  tableName: string,
  columns: string[],
  format: ExportFormat,
  options: ExportOptions = {},
): Promise<Blob> {
  const query = buildSelectQuery(tableName, columns, options);
  const rows = await runQuery(query);
  const headers = collectHeaders(columns, rows);
  const includeHeaders = options.includeHeaders ?? true;
  const prettyPrint = options.prettyPrint ?? true;

  switch (format) {
    case "csv":
      return new Blob([toCsv(headers, rows, includeHeaders)], {
        type: "text/csv;charset=utf-8",
      });
    case "json":
      return new Blob([toJson(headers, rows, includeHeaders, prettyPrint)], {
        type: "application/json;charset=utf-8",
      });
    case "sql":
      return new Blob(
        [toSql(tableName, headers, rows, options.tableName)],
        {
          type: "application/sql;charset=utf-8",
        },
      );
    case "markdown":
      return new Blob([toMarkdown(headers, rows, includeHeaders)], {
        type: "text/markdown;charset=utf-8",
      });
    case "html":
      return new Blob([toHtml(options.tableName || tableName, headers, rows, includeHeaders)], {
        type: "text/html;charset=utf-8",
      });
    default:
      return new Blob([toJson(headers, rows, includeHeaders, prettyPrint)], {
        type: "application/json;charset=utf-8",
      });
  }
}
