import {
  DEFAULT_OLLAMA_SETTINGS,
  checkOllamaConnection,
  fetchOllamaModels,
  generateOllamaText,
  loadOllamaSettings,
  saveOllamaSettings,
  sanitizeOllamaUrl,
} from "@/lib/ai/ollama-settings";

describe("ollama-settings", () => {
  const STORAGE_KEYS = {
    url: "datalens-ollama-url",
    model: "datalens-ollama-model",
    temperature: "datalens-ollama-temperature",
    maxTokens: "datalens-ollama-max-tokens",
    systemPrompt: "datalens-ollama-system-prompt",
    availableModels: "datalens-ollama-model-cache",
  } as const;

  let originalFetch: typeof globalThis.fetch | undefined;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    window.localStorage.clear();

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

  it("sanitizes ollama url by trimming trailing slashes", () => {
    expect(sanitizeOllamaUrl("http://localhost:11434//")).toBe(
      "http://localhost:11434",
    );
  });

  it("returns default url when sanitize input is empty", () => {
    expect(sanitizeOllamaUrl("")).toBe(DEFAULT_OLLAMA_SETTINGS.url);
  });

  it("returns default settings when localStorage is empty", () => {
    expect(loadOllamaSettings()).toEqual(DEFAULT_OLLAMA_SETTINGS);
  });

  it("writes normalized settings into localStorage", () => {
    const settings = {
      ...DEFAULT_OLLAMA_SETTINGS,
      url: "http://localhost:11434////",
      availableModels: ["llama", "mistral"],
    };

    saveOllamaSettings(settings);

    expect(window.localStorage.getItem(STORAGE_KEYS.url)).toBe("http://localhost:11434");
    expect(window.localStorage.getItem(STORAGE_KEYS.model)).toBe(DEFAULT_OLLAMA_SETTINGS.model);
    expect(window.localStorage.getItem(STORAGE_KEYS.temperature)).toBe(String(DEFAULT_OLLAMA_SETTINGS.temperature));
    expect(window.localStorage.getItem(STORAGE_KEYS.maxTokens)).toBe(
      String(DEFAULT_OLLAMA_SETTINGS.maxTokens),
    );
    expect(window.localStorage.getItem(STORAGE_KEYS.systemPrompt)).toBe(
      DEFAULT_OLLAMA_SETTINGS.systemPrompt,
    );
    expect(window.localStorage.getItem(STORAGE_KEYS.availableModels)).toBe(
      JSON.stringify(["llama", "mistral"]),
    );
  });

  it("loads settings from localStorage", () => {
    window.localStorage.setItem(STORAGE_KEYS.url, "http://example.local////");
    window.localStorage.setItem(STORAGE_KEYS.model, "model-x");
    window.localStorage.setItem(STORAGE_KEYS.temperature, "0.5");
    window.localStorage.setItem(STORAGE_KEYS.maxTokens, "3000");
    window.localStorage.setItem(STORAGE_KEYS.systemPrompt, "Custom prompt");
    window.localStorage.setItem(STORAGE_KEYS.availableModels, JSON.stringify(["a", "b"]));

    expect(loadOllamaSettings()).toEqual({
      url: "http://example.local",
      model: "model-x",
      temperature: 0.5,
      maxTokens: 3000,
      systemPrompt: "Custom prompt",
      availableModels: ["a", "b"],
    });
  });

  it("fetches ollama models and returns names", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3.2" }, { name: "mistral" }],
      }),
    } as Response);

    const models = await fetchOllamaModels("http://localhost:11434//");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
    expect(models).toEqual(["llama3.2", "mistral"]);
  });

  it("throws when fetchOllamaModels receives non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    await expect(fetchOllamaModels("http://localhost:11434//")).rejects.toThrow(
      "Ollama responded with 500.",
    );
  });

  it("returns connected with models when checkOllamaConnection succeeds", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3.2" }, { name: "mistral" }],
      }),
    } as Response);

    const result = await checkOllamaConnection("http://localhost:11434//");

    expect(result).toEqual({
      kind: "connected",
      message: "Connected. 2 models available.",
      models: ["llama3.2", "mistral"],
    });
  });

  it("returns error when checkOllamaConnection fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down"));

    const result = await checkOllamaConnection("http://localhost:11434");

    expect(result).toEqual({
      kind: "error",
      message: "Network down",
      models: [],
    });
  });

  it("sends POST to generate endpoint and returns trimmed content", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "  generated text  " },
      }),
    } as Response);

    const content = await generateOllamaText({
      baseUrl: "http://localhost:11434//",
      model: "llama3.2",
      prompt: "Explain this",
      systemPrompt: "You are a system",
      temperature: 0.2,
      maxTokens: 1024,
    });

    expect(content).toBe("generated text");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "llama3.2",
      stream: false,
      messages: [
        { role: "system", content: "You are a system" },
        { role: "user", content: "Explain this" },
      ],
      options: {
        temperature: 0.2,
        num_predict: 1024,
      },
    });
  });
});
