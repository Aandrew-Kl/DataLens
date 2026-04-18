import { NextResponse } from "next/server";
import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { requireAuth } from "@/lib/auth/require-auth";
import { POST } from "@/app/api/ai/explain/route";

jest.mock("next/server", () => {
  class MockNextResponse {
    body: unknown;
    status: number;

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }

    async json() {
      return this.body;
    }

    static json = jest.fn((body: unknown, init?: { status?: number }) => {
      return new MockNextResponse(body, init);
    });
  }

  return {
    NextResponse: MockNextResponse,
  };
});

jest.mock("@/lib/auth/require-auth", () => ({
  requireAuth: jest.fn(),
}));

jest.mock("@/lib/ai/ollama-client", () => ({
  checkOllamaHealth: jest.fn(),
  chat: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockRequireAuth = requireAuth as jest.Mock;

const createRequest = (body: unknown) =>
  ({
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Request;

describe("POST /api/ai/explain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: "test-user" });
  });

  it("returns 401 when authentication fails", async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await POST(createRequest({}));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns 400 when sql is missing", async () => {
    const request = createRequest({});

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Missing required field: sql" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns AI explanation when Ollama is healthy", async () => {
    const request = createRequest({ sql: "SELECT * FROM users" });

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

  it("strips fenced AI explanations before returning them", async () => {
    const request = createRequest({ sql: "SELECT * FROM users" });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockResolvedValueOnce(
      "```markdown\nThis query selects every row from users.\n```",
    );

    const response = await POST(request);
    const body = await response.json();

    expect(body).toEqual({
      explanation: "This query selects every row from users.",
      mode: "ai",
    });
  });

  it("returns fallback explanation when Ollama is unhealthy", async () => {
    const request = createRequest({ sql: "SELECT * FROM users" });

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
    const request = createRequest({ sql: "SELECT id FROM events" });

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
    const request = createRequest({ sql: "SELECT id FROM events" });

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

  it("builds a detailed fallback explanation for joins, grouping, sorting, and limits", async () => {
    const request = createRequest({
      sql: [
        "SELECT COUNT(*)",
        "FROM `orders`",
        "JOIN [users] ON orders.user_id = users.id",
        "WHERE users.active = true",
        "GROUP BY users.region",
        "ORDER BY users.region",
        "LIMIT 5",
      ].join(" "),
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(false);

    const response = await POST(request);
    const body = await response.json();

    expect(body).toEqual({
      explanation:
        'This query is fetching data from "orders" and "users". It is also combining data from multiple tables, filtering rows, and grouping similar records. It additionally handles sorting the results, calculating summary values, and limiting how many rows are returned.',
      mode: "fallback",
    });
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
