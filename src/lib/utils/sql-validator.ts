import {
  formatSQL as formatSQLInternal,
} from "@/lib/utils/sql-formatter";
import {
  highlightSQL as highlightSQLInternal,
  type SQLToken,
} from "@/lib/utils/sql-highlight";

type TokenType = "word" | "string" | "quoted" | "number" | "symbol" | "comment";

interface Token {
  value: string;
  type: TokenType;
  upper?: string;
  start: number;
  end: number;
  closed: boolean;
}

export interface ValidationError {
  code:
    | "empty"
    | "missing_statement"
    | "unclosed_string"
    | "unclosed_identifier"
    | "unclosed_comment"
    | "unbalanced_parentheses";
  message: string;
  position: number;
}

export type HighlightedToken = SQLToken;

const SQL_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "ORDER",
  "HAVING",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "FULL",
  "CROSS",
  "ON",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "BETWEEN",
  "LIKE",
  "IS",
  "NULL",
  "LIMIT",
  "OFFSET",
  "UNION",
  "ALL",
  "DISTINCT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "DESC",
  "ASC",
  "INSERT",
  "INTO",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "TABLE",
  "VALUES",
  "SET",
  "WITH",
  "EXISTS",
  "TRUE",
  "FALSE",
]);

const TABLE_CONTEXT = new Set([
  "FROM",
  "JOIN",
  "INTO",
  "UPDATE",
  "TABLE",
  "DELETE",
]);

function isWordStart(character: string): boolean {
  return /[A-Za-z_]/.test(character);
}

function isWordPart(character: string): boolean {
  return /[A-Za-z0-9_$]/.test(character);
}

function readQuotedToken(
  sql: string,
  start: number,
  quote: "'" | '"' | "`" | "[",
): { end: number; closed: boolean } {
  const endQuote = quote === "[" ? "]" : quote;
  let index = start + 1;

  while (index < sql.length) {
    if (sql[index] === endQuote) {
      if (quote !== "[" && index + 1 < sql.length && sql[index + 1] === endQuote) {
        index += 2;
        continue;
      }

      return { end: index + 1, closed: true };
    }

    index += 1;
  }

  return { end: sql.length, closed: false };
}

function tokenizeSQL(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < sql.length) {
    const character = sql[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "-" && sql[index + 1] === "-") {
      let end = index + 2;
      while (end < sql.length && sql[end] !== "\n") {
        end += 1;
      }

      tokens.push({
        value: sql.slice(index, end),
        type: "comment",
        start: index,
        end,
        closed: true,
      });
      index = end;
      continue;
    }

    if (character === "/" && sql[index + 1] === "*") {
      let end = index + 2;
      while (end < sql.length && !(sql[end] === "*" && sql[end + 1] === "/")) {
        end += 1;
      }

      const closed = end < sql.length;
      const tokenEnd = closed ? end + 2 : sql.length;
      tokens.push({
        value: sql.slice(index, tokenEnd),
        type: "comment",
        start: index,
        end: tokenEnd,
        closed,
      });
      index = tokenEnd;
      continue;
    }

    if (character === "'" || character === '"' || character === "`" || character === "[") {
      const { end, closed } = readQuotedToken(
        sql,
        index,
        character as "'" | '"' | "`" | "[",
      );
      tokens.push({
        value: sql.slice(index, end),
        type: character === "'" ? "string" : "quoted",
        start: index,
        end,
        closed,
      });
      index = end;
      continue;
    }

    if (/[0-9]/.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[0-9.]/.test(sql[end])) {
        end += 1;
      }

      tokens.push({
        value: sql.slice(index, end),
        type: "number",
        start: index,
        end,
        closed: true,
      });
      index = end;
      continue;
    }

    if (isWordStart(character)) {
      let end = index + 1;
      while (end < sql.length && isWordPart(sql[end])) {
        end += 1;
      }

      const value = sql.slice(index, end);
      tokens.push({
        value,
        type: "word",
        upper: value.toUpperCase(),
        start: index,
        end,
        closed: true,
      });
      index = end;
      continue;
    }

    const pair = sql.slice(index, index + 2);
    if (["<>", "!=", "<=", ">=", "||", "::"].includes(pair)) {
      tokens.push({
        value: pair,
        type: "symbol",
        start: index,
        end: index + 2,
        closed: true,
      });
      index += 2;
      continue;
    }

    tokens.push({
      value: character,
      type: "symbol",
      start: index,
      end: index + 1,
      closed: true,
    });
    index += 1;
  }

  return tokens;
}

function nextMeaningfulToken(tokens: Token[], start: number): Token | null {
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].type !== "comment") {
      return tokens[index];
    }
  }

  return null;
}

function previousMeaningfulToken(tokens: Token[], start: number): Token | null {
  for (let index = start; index >= 0; index -= 1) {
    if (tokens[index].type !== "comment") {
      return tokens[index];
    }
  }

  return null;
}

function cleanIdentifier(value: string): string {
  return value.replace(/^["`[]|["`\]]$/g, "").trim();
}

function readIdentifier(tokens: Token[], start: number): { name: string; nextIndex: number } | null {
  const first = tokens[start];
  if (!first || (first.type !== "word" && first.type !== "quoted")) {
    return null;
  }

  let name = cleanIdentifier(first.value);
  let index = start + 1;

  while (
    tokens[index]?.type === "symbol" &&
    tokens[index]?.value === "." &&
    (tokens[index + 1]?.type === "word" || tokens[index + 1]?.type === "quoted")
  ) {
    name += `.${cleanIdentifier(tokens[index + 1].value)}`;
    index += 2;
  }

  return { name, nextIndex: index };
}

function firstStatementToken(tokens: Token[]): Token | null {
  return tokens.find((token) => token.type === "word" || token.type === "quoted") ?? null;
}

function skipTableModifiers(tokens: Token[], start: number): number {
  let cursor = start;

  while (
    tokens[cursor]?.type === "word" &&
    ["IF", "NOT", "EXISTS", "ONLY"].includes(tokens[cursor].upper ?? "")
  ) {
    cursor += 1;
  }

  return cursor;
}

export function validateSQL(sql: string): {
  valid: boolean;
  errors: ValidationError[];
} {
  const trimmed = sql.trim();
  if (!trimmed) {
    return {
      valid: false,
      errors: [
        {
          code: "empty",
          message: "SQL cannot be empty.",
          position: 0,
        },
      ],
    };
  }

  const tokens = tokenizeSQL(sql);
  const errors: ValidationError[] = [];

  const statementToken = firstStatementToken(tokens);
  if (!statementToken || statementToken.type !== "word") {
    errors.push({
      code: "missing_statement",
      message: "SQL must start with a statement keyword.",
      position: 0,
    });
  }

  let parenthesesBalance = 0;

  tokens.forEach((token) => {
    if (!token.closed) {
      errors.push({
        code:
          token.type === "string"
            ? "unclosed_string"
            : token.type === "quoted"
              ? "unclosed_identifier"
              : "unclosed_comment",
        message:
          token.type === "string"
            ? "String literal is not closed."
            : token.type === "quoted"
              ? "Quoted identifier is not closed."
              : "Block comment is not closed.",
        position: token.start,
      });
    }

    if (token.type === "symbol" && token.value === "(") {
      parenthesesBalance += 1;
    }

    if (token.type === "symbol" && token.value === ")") {
      parenthesesBalance -= 1;
      if (parenthesesBalance < 0) {
        errors.push({
          code: "unbalanced_parentheses",
          message: "Closing parenthesis does not have a matching opening parenthesis.",
          position: token.start,
        });
        parenthesesBalance = 0;
      }
    }
  });

  if (parenthesesBalance > 0) {
    errors.push({
      code: "unbalanced_parentheses",
      message: "One or more opening parentheses are not closed.",
      position: sql.length,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function extractTableNames(sql: string): string[] {
  const tokens = tokenizeSQL(sql);
  const tables = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const upper = token.upper ?? "";

    if (token.type !== "word") {
      continue;
    }

    if (upper === "TABLE" && tokens[index - 1]?.upper === "CREATE") {
      const maybeIdentifier = readIdentifier(tokens, skipTableModifiers(tokens, index + 1));
      if (maybeIdentifier?.name) {
        tables.add(maybeIdentifier.name);
        index = maybeIdentifier.nextIndex - 1;
      }
      continue;
    }

    if (upper === "TABLE" && (tokens[index - 1]?.upper === "DROP" || tokens[index - 1]?.upper === "ALTER")) {
      const maybeIdentifier = readIdentifier(tokens, skipTableModifiers(tokens, index + 1));
      if (maybeIdentifier?.name) {
        tables.add(maybeIdentifier.name);
        index = maybeIdentifier.nextIndex - 1;
      }
      continue;
    }

    if (!TABLE_CONTEXT.has(upper)) {
      continue;
    }

    let cursor = index + 1;

    if (upper === "DELETE" && tokens[cursor]?.upper === "FROM") {
      cursor += 1;
    }

    while (tokens[cursor]?.type === "word" && ["IF", "NOT", "EXISTS", "ONLY"].includes(tokens[cursor].upper ?? "")) {
      cursor += 1;
    }

    if (tokens[cursor]?.type === "symbol" && tokens[cursor]?.value === "(") {
      continue;
    }

    const identifier = readIdentifier(tokens, cursor);
    if (identifier?.name) {
      tables.add(identifier.name);
      index = identifier.nextIndex - 1;
    }
  }

  return [...tables];
}

export function extractColumnNames(sql: string): string[] {
  const tokens = tokenizeSQL(sql);
  const columns = new Set<string>();
  const tables = new Set(extractTableNames(sql));

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word" && token.type !== "quoted") {
      continue;
    }

    const upper = token.upper ?? token.value.toUpperCase();
    if (SQL_KEYWORDS.has(upper)) {
      continue;
    }

    const previous = previousMeaningfulToken(tokens, index - 1);
    if (previous?.type === "word" && TABLE_CONTEXT.has(previous.upper ?? "")) {
      continue;
    }

    const next = nextMeaningfulToken(tokens, index + 1);
    if (next?.type === "symbol" && next.value === "(") {
      continue;
    }

    const identifier = readIdentifier(tokens, index);
    if (!identifier?.name) {
      continue;
    }

    const parts = identifier.name.split(".");
    const candidate =
      parts.length > 1 ? parts[parts.length - 1] : identifier.name;
    const maybeTable = parts.length > 1 ? parts.slice(0, -1).join(".") : identifier.name;

    if (tables.has(identifier.name) || tables.has(maybeTable)) {
      index = identifier.nextIndex - 1;
      continue;
    }

    if (candidate !== "*") {
      columns.add(candidate);
    }

    index = identifier.nextIndex - 1;
  }

  return [...columns];
}

export function formatSQL(sql: string): string {
  return formatSQLInternal(sql);
}

export function highlightSQL(sql: string): HighlightedToken[] {
  return highlightSQLInternal(sql);
}

export function detectSQLType(
  sql: string,
): "select" | "insert" | "update" | "delete" | "create" | "drop" | "alter" | "other" {
  const token = firstStatementToken(tokenizeSQL(sql));
  if (!token) {
    return "other";
  }

  switch ((token.upper ?? "").toLowerCase()) {
    case "select":
    case "insert":
    case "update":
    case "delete":
    case "create":
    case "drop":
    case "alter":
      return (token.upper ?? "").toLowerCase() as
        | "select"
        | "insert"
        | "update"
        | "delete"
        | "create"
        | "drop"
        | "alter";
    default:
      return "other";
  }
}
