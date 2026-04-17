const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

function createJsonResponse<T>(
  body: T,
  overrides: Partial<Pick<Response, "ok" | "status" | "statusText">> = {},
): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: jest.fn().mockResolvedValue(body),
    ...overrides,
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useRealTimers();
    window.localStorage.clear();
    Object.defineProperty(globalThis, "fetch", {
      writable: true,
      value: jest.fn(),
    });
  });

  afterAll(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
      return;
    }

    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  async function loadClient(apiUrl?: string) {
    if (apiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = apiUrl;
    }

    const client = await import("@/lib/api/client");
    const { ApiError } = await import("@/lib/api/types");
    const { useAuthStore } = await import("@/stores/auth-store");

    useAuthStore.setState({ token: null, isAuthenticated: false });

    return {
      ...client,
      ApiError,
      useAuthStore,
    };
  }

  test("creates requests with the configured base URL", async () => {
    const responseBody = { health: "ok" };
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(createJsonResponse(responseBody));

    const { request } = await loadClient("https://api.example.com");

    await expect(request("GET", "/status")).resolves.toEqual(responseBody);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/status",
      expect.objectContaining({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        body: undefined,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test("adds bearer auth headers when a token exists", async () => {
    const responseBody = { success: true };
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(createJsonResponse(responseBody));

    const { request, useAuthStore } = await loadClient();
    useAuthStore.getState().setToken("secret-token");

    await expect(
      request("POST", "/api/items", { id: 1, name: "alpha" }),
    ).resolves.toEqual(responseBody);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/items",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret-token",
        },
        body: JSON.stringify({ id: 1, name: "alpha" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test("clears the token and throws a normalized error on 401 responses", async () => {
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      createJsonResponse(
        { detail: "expired" },
        { ok: false, status: 401, statusText: "Unauthorized" },
      ),
    );

    const { request, ApiError, useAuthStore } = await loadClient();
    useAuthStore.getState().setToken("expired-token");

    const protectedRequest = request("GET", "/api/protected");

    await expect(protectedRequest).rejects.toBeInstanceOf(ApiError);
    await expect(protectedRequest).rejects.toMatchObject({
      status: 401,
      detail: "expired",
      body: { detail: "expired" },
    });

    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem("datalens_token")).toBeNull();
  });

  test("surfaces API error details and falls back to status text when JSON parsing fails", async () => {
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(
          { detail: "Validation failed" },
          { ok: false, status: 422, statusText: "Unprocessable Entity" },
        ),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: jest.fn().mockRejectedValue(new Error("invalid json")),
      } as unknown as Response);

    const { request, ApiError } = await loadClient();

    const invalidRequest = request("POST", "/api/items", { bad: true });

    await expect(invalidRequest).rejects.toBeInstanceOf(ApiError);
    await expect(invalidRequest).rejects.toMatchObject({
      status: 422,
      message: "Validation failed",
      detail: "Validation failed",
      body: { detail: "Validation failed" },
    });

    const fallbackErrorRequest = request("GET", "/api/fallback-error");

    await expect(fallbackErrorRequest).rejects.toBeInstanceOf(ApiError);
    await expect(fallbackErrorRequest).rejects.toMatchObject({
      status: 400,
      message: "Bad Request",
    });
  });

  test("uploads files as form data and preserves auth headers", async () => {
    const responseBody = { id: "upload-1" };
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(createJsonResponse(responseBody));

    const { uploadFile, useAuthStore } = await loadClient("https://uploads.example.com");
    useAuthStore.getState().setToken("upload-token");

    const file = new File(["hello"], "example.txt", { type: "text/plain" });

    await expect(uploadFile("/api/files", file)).resolves.toEqual(responseBody);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://uploads.example.com/api/files",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer upload-token",
        },
        body: expect.any(FormData),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test("retries transient 5xx responses with exponential backoff", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(
          { detail: "temporarily unavailable" },
          { ok: false, status: 503, statusText: "Service Unavailable" },
        ),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          { detail: "still warming up" },
          { ok: false, status: 502, statusText: "Bad Gateway" },
        ),
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));

    const { request } = await loadClient();

    const requestPromise = request("GET", "/api/retry-me");
    await jest.runAllTimersAsync();

    await expect(requestPromise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("times out requests and stops after the configured retry budget", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            const abortError = new Error("The operation was aborted.");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    );

    const { request, ApiError } = await loadClient();

    const requestPromise = request("GET", "/api/slow", undefined, {
      timeoutMs: 10,
    }).catch((error) => error);
    await jest.runAllTimersAsync();

    const error = await requestPromise;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 408,
      message: "Request timed out after 1 second.",
      body: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
