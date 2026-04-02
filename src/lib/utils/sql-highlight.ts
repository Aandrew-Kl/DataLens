/**
 * Lightweight SQL syntax highlighter.
 *
 * Tokenizes a SQL string into a flat list of typed spans that can be mapped to
 * styled elements in the UI. No external dependencies are required.
 */

/** Token types emitted by the highlighter. */
export type TokenType =
  | "keyword"
  | "function"
  | "string"
  | "number"
  | "operator"
  | "identifier"
  | "comment"
  | "plain";

/** A single highlighted span. */
export interface SQLToken {
  text: string;
  type: TokenType;
}

const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "HAVING",
  "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AS",
  "AND", "OR", "NOT", "IN", "BETWEEN", "LIKE", "IS", "NULL",
  "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  "DESC", "ASC",
  "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER",
  "TABLE", "INDEX",
  "TRUE", "FALSE",
  "WITH", "OVER", "PARTITION", "WINDOW",
  "ROWS", "RANGE", "PRECEDING", "FOLLOWING", "CURRENT", "ROW",
  "EXISTS", "ANY", "SOME",
  "CROSS", "NATURAL", "FULL",
  "SET", "VALUES",
]);

const FUNCTIONS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX",
  "COALESCE", "CAST", "EXTRACT", "DATE_TRUNC",
  "ROUND", "ABS",
  "UPPER", "LOWER", "TRIM", "SUBSTRING", "LENGTH", "CONCAT",
  "NOW", "DATE", "TIME", "TIMESTAMP", "INTERVAL",
  "ARRAY_AGG", "STRING_AGG",
  "FIRST", "LAST",
  "STDDEV", "VARIANCE",
  "LAG", "LEAD", "RANK", "ROW_NUMBER", "DENSE_RANK",
  "NTILE", "PERCENT_RANK", "CUME_DIST",
  "MEDIAN", "PERCENTILE_CONT",
]);

/** Characters that form SQL operators (individually or in pairs). */
const OPERATOR_CHARS = new Set([
  "=", "<", ">", "!", "+", "-", "*", "/", "|", ":",
]);

/** Multi-character operators, longest first for greedy matching. */
const MULTI_OPERATORS = ["<>", "!=", "<=", ">=", "||", "::"];

/**
 * Returns `true` for characters that cannot appear in an unquoted word
 * (identifiers / keywords / function names).
 */
function isWordBoundary(ch: string): boolean {
  return /[\s,();=<>!+\-*/|:]/.test(ch);
}

/**
 * Tokenize a SQL string into highlighted spans.
 *
 * The function walks the input character-by-character and produces a flat
 * array of `{ text, type }` objects. Consecutive plain-text characters are
 * merged into a single span.
 *
 * @param sql - The raw SQL string to highlight.
 * @returns An array of tokens with their semantic type.
 */
export function highlightSQL(sql: string): SQLToken[] {
  const tokens: SQLToken[] = [];
  let i = 0;
  const len = sql.length;

  /** Append a token, merging consecutive `plain` spans. */
  function push(text: string, type: TokenType) {
    if (
      type === "plain" &&
      tokens.length > 0 &&
      tokens[tokens.length - 1].type === "plain"
    ) {
      tokens[tokens.length - 1].text += text;
    } else {
      tokens.push({ text, type });
    }
  }

  while (i < len) {
    const ch = sql[i];

    // ---- Whitespace ----
    if (/\s/.test(ch)) {
      let j = i;
      while (j < len && /\s/.test(sql[j])) j++;
      push(sql.slice(i, j), "plain");
      i = j;
      continue;
    }

    // ---- Single-line comment: -- ----
    if (ch === "-" && i + 1 < len && sql[i + 1] === "-") {
      let j = i + 2;
      while (j < len && sql[j] !== "\n") j++;
      push(sql.slice(i, j), "comment");
      i = j;
      continue;
    }

    // ---- Multi-line comment: /* ... */ ----
    if (ch === "/" && i + 1 < len && sql[i + 1] === "*") {
      let j = i + 2;
      while (j < len && !(sql[j] === "*" && j + 1 < len && sql[j + 1] === "/")) {
        j++;
      }
      // Include the closing */
      if (j < len) j += 2;
      push(sql.slice(i, j), "comment");
      i = j;
      continue;
    }

    // ---- Single-quoted string: 'value' ----
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && j + 1 < len && sql[j + 1] === "'") {
          // Escaped single quote inside a string.
          j += 2;
        } else if (sql[j] === "'") {
          j++;
          break;
        } else {
          j++;
        }
      }
      push(sql.slice(i, j), "string");
      i = j;
      continue;
    }

    // ---- Double-quoted identifier: "identifier" ----
    if (ch === '"') {
      let j = i + 1;
      while (j < len && sql[j] !== '"') j++;
      if (j < len) j++; // closing quote
      push(sql.slice(i, j), "identifier");
      i = j;
      continue;
    }

    // ---- Numbers: integers and decimals ----
    if (/[0-9]/.test(ch) || (ch === "." && i + 1 < len && /[0-9]/.test(sql[i + 1]))) {
      let j = i;
      let hasDot = false;

      while (j < len) {
        if (sql[j] === "." && !hasDot) {
          hasDot = true;
          j++;
        } else if (/[0-9]/.test(sql[j])) {
          j++;
        } else {
          break;
        }
      }
      push(sql.slice(i, j), "number");
      i = j;
      continue;
    }

    // ---- Multi-character operators ----
    let matchedOp = false;
    for (const op of MULTI_OPERATORS) {
      if (sql.startsWith(op, i)) {
        push(op, "operator");
        i += op.length;
        matchedOp = true;
        break;
      }
    }
    if (matchedOp) continue;

    // ---- Single-character operators ----
    if (OPERATOR_CHARS.has(ch)) {
      push(ch, "operator");
      i++;
      continue;
    }

    // ---- Punctuation (parentheses, commas, semicolons) ----
    if (/[(),;]/.test(ch)) {
      push(ch, "plain");
      i++;
      continue;
    }

    // ---- Words (keywords, functions, plain identifiers) ----
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < len && !isWordBoundary(sql[j])) j++;

      const word = sql.slice(i, j);
      const upper = word.toUpperCase();

      // Detect function calls: a word immediately followed by `(`.
      const nextNonSpace = sql.slice(j).search(/\S/);
      const peekChar =
        nextNonSpace >= 0 ? sql[j + nextNonSpace] : undefined;

      if (FUNCTIONS.has(upper) && peekChar === "(") {
        push(word, "function");
      } else if (KEYWORDS.has(upper)) {
        push(word, "keyword");
      } else {
        push(word, "plain");
      }

      i = j;
      continue;
    }

    // ---- Anything else ----
    push(ch, "plain");
    i++;
  }

  return tokens;
}
