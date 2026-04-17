import { NextResponse } from "next/server";
import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { requireAuth } from "@/lib/auth/require-auth";
import { POST } from "@/app/api/ai/fix/route";

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
  checkOllamaHealth: jest.fn().mockResolvedValue(false),
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

describe("POST /api/ai/fix", () => {
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

  it("returns 400 when required fields are missing", async () => {
    const request = createRequest({});

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Missing required fields: sql, error, tableName, columns" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns an AI-generated fix when Ollama is healthy", async () => {
    const request = createRequest({
      sql: "SELECT id FROM users",
      error: "Binder Error: column not found",
      tableName: "users",
      columns: [{ name: "id", type: "number" }],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockResolvedValueOnce(
      '```json\n{"fixedSql":"SELECT \\"id\\" FROM \\"users\\"","explanation":"Quoted the identifiers for DuckDB."}\n```'
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      fixedSql: 'SELECT "id" FROM "users"',
      explanation: "Quoted the identifiers for DuckDB.",
      mode: "ai",
    });
  });

  it("returns fallback fix when Ollama unhealthy", async () => {
    const request = createRequest({
      sql: "SELCT * FORM users",
      error: "syntax error",
      tableName: "users",
      columns: [{ name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] }],
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      fixedSql: 'SELCT * FORM "users"',
      explanation: "Applied fallback fixes: quoted the table identifier.",
      mode: "fallback",
    });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls back when the upstream AI fixer throws", async () => {
    const request = createRequest({
      sql: "SELCT * FORM users",
      error: "syntax error",
      tableName: "users",
      columns: [{ name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] }],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockRejectedValueOnce(new Error("ollama offline"));

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      fixedSql: 'SELCT * FORM "users"',
      explanation: "Applied fallback fixes: quoted the table identifier.",
      mode: "fallback",
    });
  });
});
