import { chat, checkOllamaHealth, listModels } from "@/lib/ai/ollama-client";

describe("ollama-client", () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it("chat sends POST to /api/chat and returns message content", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: "Hello from model" } }),
    } as Response);

    const content = await chat([{ role: "user", content: "Hello" }]);

    expect(content).toBe("Hello from model");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/chat$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "llama3.2",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
      },
    });
  });

  it("chat throws on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server error",
    } as Response);

    await expect(chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
      "Ollama error: 500 Server error",
    );
  });

  it("checkOllamaHealth returns true when fetch succeeds", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);

    const isHealthy = await checkOllamaHealth();

    expect(isHealthy).toBe(true);
  });

  it("checkOllamaHealth returns false when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const isHealthy = await checkOllamaHealth();

    expect(isHealthy).toBe(false);
  });

  it("listModels returns model names array", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3.2:latest" }, { name: "mistral:7b" }],
      }),
    } as Response);

    const models = await listModels();

    expect(models).toEqual(["llama3.2:latest", "mistral:7b"]);
  });

  it("listModels returns empty array on error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Request failed"));

    const models = await listModels();

    expect(models).toEqual([]);
  });
});
