import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { POST } from "@/app/api/ai/explain/route";

jest.mock("next/server", () => ({
  NextResponse: {
    json: jest.fn((data, init) => ({
      json: async () => data,
      status: init?.status ?? 200,
    })),
  },
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
    (chat as jest.Mock).mockResolvedValueOnce("This query selects all");

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      explanation: "This query selects all",
      mode: "ai",
    });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
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
});
