import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { POST } from "@/app/api/ai/fix/route";

jest.mock("next/server", () => ({
  NextResponse: {
    json: jest.fn((data, init) => ({
      json: async () => data,
      status: init?.status ?? 200,
    })),
  },
}));

jest.mock("@/lib/ai/ollama-client", () => ({
  checkOllamaHealth: jest.fn().mockResolvedValue(false),
  chat: jest.fn(),
}));

describe("POST /api/ai/fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when required fields are missing", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({}),
    } as unknown as Request;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Missing required fields: sql, error, tableName, columns" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns fallback fix when Ollama unhealthy", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({
        sql: "SELCT * FORM users",
        error: "syntax error",
        tableName: "users",
        columns: [{ name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] }],
      }),
    } as unknown as Request;

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
});
