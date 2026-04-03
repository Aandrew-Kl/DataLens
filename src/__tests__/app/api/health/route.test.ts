import { checkOllamaHealth, listModels } from "@/lib/ai/ollama-client";
import { GET } from "@/app/api/health/route";

jest.mock("next/server", () => ({
  NextResponse: {
    json: jest.fn((data) => ({ json: async () => data })),
  },
}));

jest.mock("@/lib/ai/ollama-client", () => ({
  checkOllamaHealth: jest.fn(),
  listModels: jest.fn(),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns connected status when Ollama is healthy", async () => {
    const mockCheck = checkOllamaHealth as jest.Mock;
    const mockList = listModels as jest.Mock;

    mockCheck.mockResolvedValueOnce(true);
    mockList.mockResolvedValueOnce(["llama3.2"]);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({
      status: "connected",
      ollama: true,
      models: ["llama3.2"],
    });
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("returns disconnected status when Ollama is unhealthy", async () => {
    const mockCheck = checkOllamaHealth as jest.Mock;
    const mockList = listModels as jest.Mock;

    mockCheck.mockResolvedValueOnce(false);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({
      status: "disconnected",
      ollama: false,
      models: [],
    });
    expect(mockList).not.toHaveBeenCalled();
  });
});
