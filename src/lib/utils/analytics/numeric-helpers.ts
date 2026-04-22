export { quoteIdentifier } from "../sql";

export function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toCount(value: unknown) {
  return Math.max(0, Math.round(toNumber(value) ?? 0));
}

export function toDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function toIsoDate(value: unknown) {
  const parsed = toDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function dataUrlToBytes(dataUrl: string) {
  const [header, encoded] = dataUrl.split(",");
  const mimeMatch = /data:(.*?);base64/.exec(header ?? "");
  const binary = window.atob(encoded ?? "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    bytes,
    mimeType: mimeMatch?.[1] ?? "image/png",
  };
}
