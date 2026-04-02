type TokenType = "word" | "string" | "quoted" | "number" | "symbol" | "comment";
interface Token { value: string; type: TokenType; upper?: string }

const INDENT = "  ";
const UPPERCASE_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "LIMIT", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL",
  "CROSS", "ON", "AND", "OR", "HAVING", "UNION", "ALL", "AS", "DISTINCT", "WITH", "IN", "EXISTS",
]);
const MAJOR_CLAUSES = new Set(["SELECT", "FROM", "WHERE", "HAVING", "LIMIT", "UNION", "JOIN"]);
const JOIN_PREFIXES = new Set(["LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS"]);
const SPACE_BEFORE_PAREN = new Set(["IN", "EXISTS", "VALUES", "SELECT", "FROM", "WHERE", "HAVING", "ON", "AND", "OR", "BY", "LIMIT", "JOIN", "UNION"]);

function isWordStart(ch: string): boolean { return /[A-Za-z_]/.test(ch); }
function isWordPart(ch: string): boolean { return /[A-Za-z0-9_$]/.test(ch); }

function readQuoted(sql: string, start: number, quote: "'" | '"' | "`" | "["): number {
  const endQuote = quote === "[" ? "]" : quote;
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === endQuote) {
      if (quote !== "[" && i + 1 < sql.length && sql[i + 1] === endQuote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

function tokenizeSQL(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      let j = i + 2;
      while (j < sql.length && sql[j] !== "\n") j++;
      tokens.push({ value: sql.slice(i, j), type: "comment" });
      i = j;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      let j = i + 2;
      while (j < sql.length && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
      tokens.push({ value: sql.slice(i, Math.min(j + 2, sql.length)), type: "comment" });
      i = Math.min(j + 2, sql.length);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const end = readQuoted(sql, i, ch as "'" | '"' | "`" | "[");
      tokens.push({ value: sql.slice(i, end), type: ch === "'" ? "string" : "quoted" });
      i = end;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[0-9.]/.test(sql[j])) j++;
      tokens.push({ value: sql.slice(i, j), type: "number" });
      i = j;
      continue;
    }
    if (isWordStart(ch)) {
      let j = i + 1;
      while (j < sql.length && isWordPart(sql[j])) j++;
      const value = sql.slice(i, j);
      tokens.push({ value, type: "word", upper: value.toUpperCase() });
      i = j;
      continue;
    }
    const pair = sql.slice(i, i + 2);
    if (["<>", "!=", "<=", ">=", "||", "::"].includes(pair)) {
      tokens.push({ value: pair, type: "symbol" });
      i += 2;
      continue;
    }
    tokens.push({ value: ch, type: "symbol" });
    i++;
  }
  return tokens;
}

function nextMeaningful(tokens: Token[], start: number): Token | null {
  for (let i = start; i < tokens.length; i++) if (tokens[i].type !== "comment") return tokens[i];
  return null;
}

/**
 * Pretty-print SQL while preserving string literals and quoted identifiers exactly.
 */
export function formatSQL(sql: string): string {
  const tokens = tokenizeSQL(sql);
  if (tokens.length === 0) return "";

  let output = "";
  let blockIndent = 0;
  let pendingIndent = 0;
  let lineStart = true;
  let clause = "";
  let inlineDepth = 0;
  let prev: Token | null = null;
  const subqueryStack: boolean[] = [];
  const clauseStack: string[] = [];

  const newline = (extra = 0) => {
    output = output.trimEnd();
    if (output && !output.endsWith("\n")) output += "\n";
    pendingIndent = blockIndent + extra;
    lineStart = true;
  };

  const write = (text: string) => {
    if (lineStart) {
      output += INDENT.repeat(pendingIndent);
      lineStart = false;
    }
    output += text;
  };

  const writeValue = (text: string) => {
    if (!lineStart && output.length > 0) {
      const last = output[output.length - 1];
      if (![" ", "\n", "(", "."].includes(last)) output += " ";
    }
    write(text);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const upper = token.upper ?? "";

    if (token.type === "comment") { newline(); write(token.value); newline(); prev = token; continue; }

    if (token.type === "word") {
      if (upper === "GROUP" && tokens[i + 1]?.upper === "BY") { newline(); write("GROUP BY"); clause = "GROUP BY"; i++; prev = { value: "BY", type: "word", upper: "BY" }; continue; }
      if (upper === "ORDER" && tokens[i + 1]?.upper === "BY") { newline(); write("ORDER BY"); clause = "ORDER BY"; i++; prev = { value: "BY", type: "word", upper: "BY" }; continue; }
      if (JOIN_PREFIXES.has(upper) && tokens[i + 1]?.upper === "JOIN") { newline(); write(`${upper} JOIN`); clause = "JOIN"; i++; prev = { value: "JOIN", type: "word", upper: "JOIN" }; continue; }
      if (MAJOR_CLAUSES.has(upper)) {
        newline();
        write(upper);
        clause = upper;
        if (upper === "UNION" && tokens[i + 1]?.upper === "ALL") { write(" ALL"); i++; }
        if (upper === "SELECT") newline(1);
        prev = token;
        continue;
      }
      if (upper === "ON") { newline(1); write("ON"); clause = "ON"; prev = token; continue; }
      if ((upper === "AND" || upper === "OR") && ["WHERE", "HAVING", "ON"].includes(clause)) { newline(1); write(upper); prev = token; continue; }
      writeValue(UPPERCASE_KEYWORDS.has(upper) ? upper : token.value);
      prev = token;
      continue;
    }

    if (token.value === ",") { write(","); if (inlineDepth === 0 && ["SELECT", "GROUP BY", "ORDER BY"].includes(clause)) newline(1); else output += " "; prev = token; continue; }

    if (token.value === "(") {
      const next = nextMeaningful(tokens, i + 1);
      const isSubquery = next?.type === "word" && ["SELECT", "WITH"].includes(next.upper ?? "");
      const prevUpper = prev?.upper ?? "";
      const omitSpace = !prev || prev.value === "." || prev.value === "(" || (prev.type === "word" && !SPACE_BEFORE_PAREN.has(prevUpper));
      if (omitSpace) write("(");
      else writeValue("(");
      subqueryStack.push(isSubquery);
      if (isSubquery) { clauseStack.push(clause); blockIndent++; newline(); } else inlineDepth++;
      prev = token;
      continue;
    }

    if (token.value === ")") {
      const isSubquery = subqueryStack.pop() ?? false;
      if (isSubquery) { blockIndent = Math.max(blockIndent - 1, 0); clause = clauseStack.pop() ?? ""; newline(); write(")"); }
      else { inlineDepth = Math.max(inlineDepth - 1, 0); write(")"); }
      prev = token;
      continue;
    }

    if (token.value === ".") { write("."); prev = token; continue; }
    if (token.value === ";") { output = output.trimEnd(); write(";"); if (i < tokens.length - 1) newline(); clause = ""; prev = token; continue; }

    writeValue(token.value);
    prev = token;
  }

  return output.trim();
}
