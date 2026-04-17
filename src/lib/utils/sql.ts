export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
