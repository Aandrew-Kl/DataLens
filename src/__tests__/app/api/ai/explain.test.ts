import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { POST } from "@/app/api/ai/explain/route";

jest.mock("next/server", () => {
  class MockNextResponse {}

  return {
    NextResponse: Object.assign(MockNextResponse, {
      json: jest.fn((data, init) => ({
        json: async () => data,
        status: init?.status ?? 200,
      })),
    }),
  };
});

jest.mock("@/lib/auth/require-auth", () => ({
  requireAuth: jest.fn().mockResolvedValue({ userId: "test-user" }),
}));

jest.mock("@/lib/ai/ollama-client", () => ({
  checkOllamaHealth: jest.fn(),
  chat: jest.fn(),
}));

describe("POST /api/ai/explain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when sql is missing", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({}),
    } as unknown as Request;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Missing required field: sql" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns AI explanation when Ollama is healthy", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({ sql: "SELECT * FROM users" }),
    } as unknown as Request;

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockResolvedValueOnce("This query selects every row from users.");

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      explanation: "This query selects every row from users.",
      mode: "ai",
    });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);

    const messages = (chat as jest.Mock).mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("plain English");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("SELECT * FROM users");
  });

  it("returns fallback explanation when Ollama is unhealthy", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({ sql: "SELECT * FROM users" }),
    } as unknown as Request;

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(false);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      explanation:
        'This query is fetching data from "users". It returns the selected columns without additional filtering or aggregation.',
      mode: "fallback",
    });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls back when Ollama is healthy but returns blank output", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({ sql: "SELECT id FROM events" }),
    } as unknown as Request;

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockResolvedValueOnce("   ");

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      explanation:
        'This query is fetching data from "events". It returns the selected columns without additional filtering or aggregation.',
      mode: "fallback",
    });
  });

  it("falls back when Ollama is healthy but chat throws", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({ sql: "SELECT id FROM events" }),
    } as unknown as Request;

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockRejectedValueOnce(new Error("AI unavailable"));

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      explanation:
        'This query is fetching data from "events". It returns the selected columns without additional filtering or aggregation.',
      mode: "fallback",
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when request parsing fails", async () => {
    const request = {
      json: jest.fn().mockRejectedValueOnce(new Error("bad payload")),
    } as unknown as Request;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to explain SQL query." });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });
});
