type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue };

function serializeValue(value: unknown): SerializableValue {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause ? serializeValue(value.cause) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeValue(item)])
    );
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value as SerializableValue;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = new Date().toISOString();
  const serializedContext = context ? serializeValue(context) : undefined;
  const method = level === "info" ? console.info : level === "warn" ? console.warn : console.error;

  if (process.env.NODE_ENV === "production") {
    method(
      JSON.stringify({
        timestamp,
        level,
        message,
        context: serializedContext,
      })
    );
    return;
  }

  if (serializedContext) {
    method(`[${timestamp}] ${level.toUpperCase()} ${message}`, serializedContext);
    return;
  }

  method(`[${timestamp}] ${level.toUpperCase()} ${message}`);
}

export const logger = {
  info(message: string, context?: LogContext) {
    log("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    log("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    log("error", message, context);
  },
};
