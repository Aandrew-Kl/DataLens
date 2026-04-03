import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import OllamaSettings from "@/components/settings/ollama-settings";
import {
  checkOllamaConnection,
  DEFAULT_OLLAMA_SETTINGS,
  loadOllamaSettings,
  sanitizeOllamaUrl,
  saveOllamaSettings,
} from "@/lib/ai/ollama-settings";

jest.mock("@/lib/ai/ollama-settings", () => ({
  DEFAULT_OLLAMA_SETTINGS: {
    url: "http://localhost:11434",
    model: "llama3.2",
    temperature: 0.2,
    maxTokens: 2048,
    systemPrompt:
      "You are DataLens AI. Explain datasets clearly, stay concise, and prefer actionable analytical guidance.",
    availableModels: [],
  },
  checkOllamaConnection: jest.fn(),
  loadOllamaSettings: jest.fn(),
  sanitizeOllamaUrl: jest.fn((value: string) => {
    const trimmed = value.trim();
    return (trimmed || "http://localhost:11434").replace(/\/+$/, "");
  }),
  saveOllamaSettings: jest.fn(),
}));

const mockCheckOllamaConnection = jest.mocked(checkOllamaConnection);
const mockLoadOllamaSettings = jest.mocked(loadOllamaSettings);
const mockSanitizeOllamaUrl = jest.mocked(sanitizeOllamaUrl);
const mockSaveOllamaSettings = jest.mocked(saveOllamaSettings);

async function renderAsync() {
  await act(async () => {
    render(<OllamaSettings />);
  });
}

describe("OllamaSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadOllamaSettings.mockReturnValue({
      url: "http://localhost:11434",
      model: "llama3.2",
      temperature: 0.2,
      maxTokens: 2048,
      systemPrompt: "Keep explanations concise.",
      availableModels: ["llama3.2"],
    });
  });

  it("renders the saved Ollama settings on load", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Configure the local model endpoint used across AI features",
      }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("http://localhost:11434")).toBeInTheDocument();
    expect(screen.getByDisplayValue("llama3.2")).toBeInTheDocument();
    expect(screen.getByText("Connection has not been checked yet.")).toBeInTheDocument();
  });

  it("tests the Ollama connection and refreshes the available model list", async () => {
    const user = userEvent.setup();

    mockCheckOllamaConnection.mockResolvedValue({
      kind: "connected",
      message: "Connected. 2 models available.",
      models: ["mistral", "llama3.2"],
    });

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(
      await screen.findByText("Connected. 2 models available."),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "mistral" })).toBeInTheDocument();
    expect(mockCheckOllamaConnection).toHaveBeenCalledWith("http://localhost:11434");
  });

  it("saves normalized settings and restores the default system prompt when blank", async () => {
    const user = userEvent.setup();

    await renderAsync();

    await user.clear(screen.getByLabelText("Ollama URL"));
    await user.type(
      screen.getByLabelText("Ollama URL"),
      " http://ollama.local:11434/ ",
    );
    fireEvent.change(screen.getAllByRole("slider")[0], {
      target: { value: "0.35" },
    });
    fireEvent.change(screen.getAllByRole("slider")[1], {
      target: { value: "2304" },
    });
    await user.clear(screen.getByDisplayValue("Keep explanations concise."));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(mockSaveOllamaSettings).toHaveBeenCalledWith({
        url: "http://ollama.local:11434",
        model: "llama3.2",
        availableModels: ["llama3.2"],
        temperature: 0.35,
        maxTokens: 2304,
        systemPrompt: DEFAULT_OLLAMA_SETTINGS.systemPrompt,
      });
    });
    expect(screen.getByText("Ollama settings saved to localStorage.")).toBeInTheDocument();
    expect(mockSanitizeOllamaUrl).toHaveBeenCalled();
  });
});
