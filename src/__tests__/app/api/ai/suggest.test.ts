import { NextResponse } from "next/server";
import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { generateFallbackDashboard, generateFallbackQuestions } from "@/lib/ai/fallback";
import { autoDashboardPrompt, suggestQuestionsPrompt } from "@/lib/ai/prompts";
import { requireAuth } from "@/lib/auth/require-auth";
import { POST } from "@/app/api/ai/suggest/route";

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

jest.mock("@/lib/ai/prompts", () => ({
  suggestQuestionsPrompt: jest.fn(),
  autoDashboardPrompt: jest.fn(),
}));

jest.mock("@/lib/ai/fallback", () => ({
  generateFallbackQuestions: jest.fn(),
  generateFallbackDashboard: jest.fn(),
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

const createCloneableRequest = (body: unknown) =>
  ({
    json: jest.fn().mockResolvedValue(body),
    clone: jest.fn(() => ({
      json: jest.fn().mockResolvedValue(body),
    })),
  }) as unknown as Request & { clone: jest.Mock };

describe("POST /api/ai/suggest", () => {
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

  it("returns AI questions when Ollama is healthy", async () => {
    const request = createRequest({
      type: "questions",
      tableName: "users",
      columns: [{ name: "id", type: "number" }],
      rowCount: 20,
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (suggestQuestionsPrompt as jest.Mock).mockReturnValueOnce([
      { role: "user", content: "prompt" },
    ]);
    (chat as jest.Mock).mockResolvedValueOnce('["What is the average age?"]');

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ questions: ["What is the average age?"], mode: "ai" });
    expect(suggestQuestionsPrompt).toHaveBeenCalledWith(
      "users",
      [{ name: "id", type: "number" }],
      20
    );
    expect(chat).toHaveBeenCalledWith([{ role: "user", content: "prompt" }]);
    expect(generateFallbackQuestions).not.toHaveBeenCalled();
  });

  it("returns fallback questions when Ollama is unhealthy and type is questions", async () => {
    const request = createRequest({
      type: "questions",
      tableName: "users",
      columns: [{ name: "id", type: "number" }],
      rowCount: 20,
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(false);
    (generateFallbackQuestions as jest.Mock).mockReturnValueOnce(["Q1", "Q2"]);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ questions: ["Q1", "Q2"], mode: "fallback" });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(generateFallbackQuestions).toHaveBeenCalledWith("users", [{ name: "id", type: "number" }]);
    expect(chat).not.toHaveBeenCalled();
    expect(suggestQuestionsPrompt).not.toHaveBeenCalled();
  });

  it("returns fallback dashboard when Ollama is unhealthy and type is dashboard", async () => {
    const request = createRequest({
      type: "dashboard",
      tableName: "events",
      columns: [{ name: "event", type: "string" }],
      rowCount: 45,
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(false);
    (generateFallbackDashboard as jest.Mock).mockReturnValueOnce({ title: "Dashboard", widgets: [] });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ title: "Dashboard", widgets: [], mode: "fallback" });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(generateFallbackDashboard).toHaveBeenCalledWith("events", [{ name: "event", type: "string" }], 45);
    expect(chat).not.toHaveBeenCalled();
    expect(autoDashboardPrompt).not.toHaveBeenCalled();
  });

  it("returns 400 when type is invalid", async () => {
    const request = createRequest({
      type: "invalid",
      tableName: "events",
      columns: [{ name: "event", type: "string" }],
      rowCount: 45,
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid type" });
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls back when the upstream AI call fails after auth succeeds", async () => {
    const body = {
      type: "questions",
      tableName: "users",
      columns: [{ name: "id", type: "number" }],
      rowCount: 20,
    };
    const request = createCloneableRequest(body);

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (suggestQuestionsPrompt as jest.Mock).mockReturnValueOnce([
      { role: "user", content: "prompt" },
    ]);
    (chat as jest.Mock).mockRejectedValueOnce(new Error("upstream unavailable"));
    (generateFallbackQuestions as jest.Mock).mockReturnValueOnce(["Fallback question"]);

    const response = await POST(request);
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({
      questions: ["Fallback question"],
      mode: "fallback",
    });
    expect(request.clone).toHaveBeenCalledTimes(1);
  });
});
