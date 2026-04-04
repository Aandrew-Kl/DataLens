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
    const { useAuthStore } = await import("@/stores/auth-store");

    useAuthStore.setState({ token: null, isAuthenticated: false });

    return {
      ...client,
      useAuthStore,
    };
  }

  test("creates requests with the configured base URL", async () => {
    const responseBody = { health: "ok" };
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(createJsonResponse(responseBody));

    const { request } = await loadClient("https://api.example.com");

    await expect(request("GET", "/status")).resolves.toEqual(responseBody);

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/status", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      body: undefined,
    });
  });

  test("adds bearer auth headers when a token exists", async () => {
    const responseBody = { success: true };
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(createJsonResponse(responseBody));

    const { request, useAuthStore } = await loadClient();
    useAuthStore.getState().setToken("secret-token");

    await expect(
      request("POST", "/api/v1/items", { id: 1, name: "alpha" }),
    ).resolves.toEqual(responseBody);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/items",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret-token",
        },
        body: JSON.stringify({ id: 1, name: "alpha" }),
      },
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

    const { request, useAuthStore } = await loadClient();
    useAuthStore.getState().setToken("expired-token");

    await expect(request("GET", "/api/v1/protected")).rejects.toEqual({
      status: 401,
      message: "Unauthorized",
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
        status: 500,
        statusText: "Server Error",
        json: jest.fn().mockRejectedValue(new Error("invalid json")),
      } as unknown as Response);

    const { request } = await loadClient();

    await expect(request("POST", "/api/v1/items", { bad: true })).rejects.toEqual({
      status: 422,
      message: "Validation failed",
      detail: "Validation failed",
    });

    await expect(request("GET", "/api/v1/fallback-error")).rejects.toEqual({
      status: 500,
      message: "Server Error",
      detail: "Server Error",
    });
  });

  test("uploads files as form data and preserves auth headers", async () => {
    const responseBody = { id: "upload-1" };
    const fetchMock = jest.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(createJsonResponse(responseBody));

    const { uploadFile, useAuthStore } = await loadClient("https://uploads.example.com");
    useAuthStore.getState().setToken("upload-token");

    const file = new File(["hello"], "example.txt", { type: "text/plain" });

    await expect(uploadFile("/api/v1/files", file)).resolves.toEqual(responseBody);

    expect(fetchMock).toHaveBeenCalledWith("https://uploads.example.com/api/v1/files", {
      method: "POST",
      headers: {
        Authorization: "Bearer upload-token",
      },
      body: expect.any(FormData),
    });
  });
});
