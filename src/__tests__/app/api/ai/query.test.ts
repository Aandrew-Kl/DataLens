import { checkOllamaHealth } from "@/lib/ai/ollama-client";
import { generateSQL } from "@/lib/ai/sql-generator";
import { generateFallbackSQL } from "@/lib/ai/fallback";
import { POST } from "@/app/api/ai/query/route";

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
}));

jest.mock("@/lib/ai/sql-generator", () => ({
  generateSQL: jest.fn(),
}));

jest.mock("@/lib/ai/fallback", () => ({
  generateFallbackSQL: jest.fn(),
}));

describe("POST /api/ai/query", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when required fields missing (empty body)", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({}),
    } as unknown as Request;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Missing required fields" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(generateSQL).not.toHaveBeenCalled();
    expect(generateFallbackSQL).not.toHaveBeenCalled();
  });

  it("returns SQL via AI when Ollama is healthy", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({
        question: "How many users?",
        tableName: "users",
        columns: [],
      }),
    } as unknown as Request;

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
    const request = {
      json: jest.fn().mockResolvedValue({
        question: "How many users?",
        tableName: "users",
        columns: [],
      }),
    } as unknown as Request;

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
});
