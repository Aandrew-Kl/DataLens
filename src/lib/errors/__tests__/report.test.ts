import * as Sentry from "@sentry/nextjs";
import { reportError } from "@/lib/errors/report";

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

describe("reportError", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("reports via Sentry when a DSN is configured", () => {
    process.env = {
      ...process.env,
      NEXT_PUBLIC_SENTRY_DSN: "https://example@sentry.io/1",
      NODE_ENV: "production",
    };

    const error = new Error("boom");
    reportError(error, { scope: "sentry-test", detail: 42 });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      extra: { scope: "sentry-test", detail: 42 },
    });
  });

  it("logs to console outside production", () => {
    process.env = { ...process.env, NODE_ENV: "test" };
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const error = new Error("local failure");
    reportError(error, { scope: "dev-test" });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[reportError:dev-test]",
      error,
      { scope: "dev-test" },
    );

    consoleSpy.mockRestore();
  });

  it("normalizes non-Error values", () => {
    process.env = {
      ...process.env,
      NEXT_PUBLIC_SENTRY_DSN: "https://example@sentry.io/1",
      NODE_ENV: "production",
    };

    reportError("plain string", { scope: "string-test" });
    reportError({ code: 500 }, { scope: "object-test" });

    const calls = (Sentry.captureException as jest.Mock).mock.calls;
    expect(calls[0][0]).toBeInstanceOf(Error);
    expect(calls[0][0].message).toBe("plain string");
    expect(calls[1][0]).toBeInstanceOf(Error);
    expect(calls[1][0].message).toBe("[object Object]");
  });
});
