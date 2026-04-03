import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiPlayground from "@/components/ai/ai-playground";
import {
  checkOllamaConnection,
  generateOllamaText,
  loadOllamaSettings,
  saveOllamaSettings,
} from "@/lib/ai/ollama-settings";

jest.mock("@/lib/ai/ollama-settings", () => ({
  checkOllamaConnection: jest.fn(),
  generateOllamaText: jest.fn(),
  loadOllamaSettings: jest.fn(),
  saveOllamaSettings: jest.fn(),
}));

const mockCheckOllamaConnection = jest.mocked(checkOllamaConnection);
const mockGenerateOllamaText = jest.mocked(generateOllamaText);
const mockLoadOllamaSettings = jest.mocked(loadOllamaSettings);
const mockSaveOllamaSettings = jest.mocked(saveOllamaSettings);

async function renderAsync() {
  await act(async () => {
    render(<AiPlayground />);
  });
}

describe("AiPlayground", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockLoadOllamaSettings.mockReturnValue({
      url: "http://localhost:11434",
      model: "llama3.2",
      temperature: 0.2,
      maxTokens: 2048,
      systemPrompt: "Stay concise.",
      availableModels: ["llama3.2"],
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders stored history entries and reloads a saved prompt when selected", async () => {
    window.localStorage.setItem(
      "datalens-ai-playground-history",
      JSON.stringify([
        {
          id: "entry-1",
          prompt: "Summarize weekly anomalies",
          response: "A sharp jump happened on Monday.",
          model: "mistral",
          createdAt: 1_711_900_000_000,
        },
      ]),
    );

    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Experiment with prompts against the locally configured Ollama model",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Summarize weekly anomalies")).toBeInTheDocument();
    expect(
      screen.getByText("Run a prompt to render the model output here."),
    ).toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Summarize weekly anomalies/i }));

    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "Summarize weekly anomalies",
    );
    expect(screen.getByText("A sharp jump happened on Monday.")).toBeInTheDocument();
  });

  it("refreshes the Ollama status and updates model choices", async () => {
    const user = userEvent.setup();

    mockCheckOllamaConnection.mockResolvedValue({
      kind: "connected",
      message: "Connected. 2 models available.",
      models: ["mistral", "llama3.2"],
    });

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Refresh status" }));

    expect(
      await screen.findByText("Connected. 2 models available."),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "mistral" })).toBeInTheDocument();
    expect(mockCheckOllamaConnection).toHaveBeenCalledWith("http://localhost:11434");
  });

  it("runs a prompt, persists the response, and enables copying", async () => {
    const user = userEvent.setup();

    mockCheckOllamaConnection.mockResolvedValue({
      kind: "connected",
      message: "Connected. 1 model available.",
      models: ["llama3.2"],
    });
    mockGenerateOllamaText.mockResolvedValue("Revenue accelerated after the March launch.");

    await renderAsync();

    await user.clear(screen.getByRole("textbox", { name: "Prompt" }));
    await user.type(
      screen.getByRole("textbox", { name: "Prompt" }),
      "Explain the revenue spike",
    );
    await user.click(screen.getByRole("button", { name: "Run prompt" }));

    expect(
      await screen.findByText("Revenue accelerated after the March launch."),
    ).toBeInTheDocument();
    expect(mockGenerateOllamaText).toHaveBeenCalledWith({
      baseUrl: "http://localhost:11434",
      model: "llama3.2",
      prompt: "Explain the revenue spike",
      systemPrompt: "Stay concise.",
      temperature: 0.2,
      maxTokens: 2048,
    });
    expect(mockSaveOllamaSettings).toHaveBeenCalled();

    const savedHistory = JSON.parse(
      window.localStorage.getItem("datalens-ai-playground-history") ?? "[]",
    ) as Array<{ prompt: string; response: string }>;
    expect(savedHistory[0]).toEqual(
      expect.objectContaining({
        prompt: "Explain the revenue spike",
        response: "Revenue accelerated after the March launch.",
      }),
    );
    expect(screen.getByRole("button", { name: "Copy response" })).toBeEnabled();
  });

  it("shows the connection failure and skips text generation when Ollama is unavailable", async () => {
    const user = userEvent.setup();

    mockCheckOllamaConnection.mockResolvedValue({
      kind: "error",
      message: "Unable to reach the Ollama server.",
      models: [],
    });

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Run prompt" }));

    expect(
      await screen.findByText("Unable to reach the Ollama server."),
    ).toBeInTheDocument();
    expect(mockGenerateOllamaText).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Clear history" }));

    await waitFor(() => {
      expect(screen.getByText("No prompts saved yet.")).toBeInTheDocument();
    });
  });
});
