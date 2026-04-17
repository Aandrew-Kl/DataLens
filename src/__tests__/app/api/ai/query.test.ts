import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/ai/ollama-client";
import { generateSQL } from "@/lib/ai/sql-generator";
import { generateFallbackSQL } from "@/lib/ai/fallback";
import { requireAuth } from "@/lib/auth/require-auth";
import { POST } from "@/app/api/ai/query/route";

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
}));

jest.mock("@/lib/ai/sql-generator", () => ({
  generateSQL: jest.fn(),
}));

jest.mock("@/lib/ai/fallback", () => ({
  generateFallbackSQL: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    error: jest.fn(),
  },
}));

const mockRequireAuth = requireAuth as jest.Mock;

const createRequest = (body: unknown) =>
  ({
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Request;

describe("POST /api/ai/query", () => {
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
    expect(generateSQL).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields missing (empty body)", async () => {
    const request = createRequest({});

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Missing required fields" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(generateSQL).not.toHaveBeenCalled();
    expect(generateFallbackSQL).not.toHaveBeenCalled();
  });

  it("returns SQL via AI when Ollama is healthy", async () => {
    const request = createRequest({
      question: "How many users?",
      tableName: "users",
      columns: [],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (generateSQL as jest.Mock).mockResolvedValueOnce("SELECT 1");

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ sql: "SELECT 1", mode: "ai" });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(generateSQL).toHaveBeenCalledTimes(1);
    expect(generateFallbackSQL).not.toHaveBeenCalled();
  });

  it("returns fallback SQL when Ollama is unhealthy", async () => {
    const request = createRequest({
      question: "How many users?",
      tableName: "users",
      columns: [],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(false);
    (generateFallbackSQL as jest.Mock).mockReturnValueOnce("SELECT *");

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ sql: "SELECT *", mode: "fallback" });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(generateSQL).not.toHaveBeenCalled();
    expect(generateFallbackSQL).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the upstream SQL generator throws", async () => {
    const request = createRequest({
      question: "How many users?",
      tableName: "users",
      columns: [],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (generateSQL as jest.Mock).mockRejectedValueOnce(new Error("ollama offline"));

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to generate query. Is Ollama running?" });
  });
});
