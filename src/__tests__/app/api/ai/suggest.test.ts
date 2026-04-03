import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { generateFallbackDashboard, generateFallbackQuestions } from "@/lib/ai/fallback";
import { autoDashboardPrompt, suggestQuestionsPrompt } from "@/lib/ai/prompts";
import { POST } from "@/app/api/ai/suggest/route";

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

jest.mock("@/lib/ai/prompts", () => ({
  suggestQuestionsPrompt: jest.fn(),
  autoDashboardPrompt: jest.fn(),
}));

jest.mock("@/lib/ai/fallback", () => ({
  generateFallbackQuestions: jest.fn(),
  generateFallbackDashboard: jest.fn(),
}));

describe("POST /api/ai/suggest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns fallback questions when Ollama is unhealthy and type is questions", async () => {
    const request = {
      json: jest.fn().mockResolvedValue({
        type: "questions",
        tableName: "users",
        columns: [{ name: "id", type: "number" }],
        rowCount: 20,
      }),
    } as unknown as Request;

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
    const request = {
      json: jest.fn().mockResolvedValue({
        type: "dashboard",
        tableName: "events",
        columns: [{ name: "event", type: "string" }],
        rowCount: 45,
      }),
    } as unknown as Request;

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
    const request = {
      json: jest.fn().mockResolvedValue({
        type: "invalid",
        tableName: "events",
        columns: [{ name: "event", type: "string" }],
        rowCount: 45,
      }),
    } as unknown as Request;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid type" });
    expect(chat).not.toHaveBeenCalled();
  });
});
