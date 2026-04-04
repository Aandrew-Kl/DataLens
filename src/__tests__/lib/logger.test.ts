import { logger } from "@/lib/logger";

const FIXED_TIMESTAMP = "2024-01-02T03:04:05.678Z";
const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined): void {
  Object.defineProperty(process.env, "NODE_ENV", {
    configurable: true,
    value,
    writable: true,
  });
}

describe("logger", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse(FIXED_TIMESTAMP));
    setNodeEnv("test");
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("logs info messages with a timestamp in non-production environments", () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    logger.info("Auth token restored");

    expect(infoSpy).toHaveBeenCalledWith(
      `[${FIXED_TIMESTAMP}] INFO Auth token restored`,
    );
  });

  it("serializes nested context values for non-production warning logs", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const rootCause = new Error("Database unavailable");
    const failure = new Error("Request failed");

    failure.cause = rootCause;

    logger.warn("Authentication degraded", {
      attempt: 2,
      meta: {
        requestId: BigInt(99),
        tags: ["auth", "retry"],
        failure,
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      `[${FIXED_TIMESTAMP}] WARN Authentication degraded`,
      {
        attempt: 2,
        meta: {
          requestId: "99",
          tags: ["auth", "retry"],
          failure: {
            name: "Error",
            message: "Request failed",
            stack: expect.any(String),
            cause: {
              name: "Error",
              message: "Database unavailable",
              stack: expect.any(String),
              cause: undefined,
            },
          },
        },
      },
    );
  });

  it("emits structured JSON in production", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    setNodeEnv("production");

    logger.error("Authentication failed", {
      code: "TOKEN_EXPIRED",
      retryable: false,
      identifiers: [BigInt(1), BigInt(2)],
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);

    const [payload] = errorSpy.mock.calls[0] ?? [];

    expect(JSON.parse(String(payload))).toEqual({
      timestamp: FIXED_TIMESTAMP,
      level: "error",
      message: "Authentication failed",
      context: {
        code: "TOKEN_EXPIRED",
        retryable: false,
        identifiers: ["1", "2"],
      },
    });
  });
});
