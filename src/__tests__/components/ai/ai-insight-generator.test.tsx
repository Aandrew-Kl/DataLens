import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AIInsightGenerator from "@/components/ai/ai-insight-generator";
import { runQuery } from "@/lib/duckdb/client";
import {
  generateOllamaText,
  loadOllamaSettings,
} from "@/lib/ai/ollama-settings";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/ai/ollama-settings", () => ({
  generateOllamaText: jest.fn(),
  loadOllamaSettings: jest.fn(() => ({
    url: "http://localhost:11434",
    model: "llama3.2",
    temperature: 0.2,
    maxTokens: 1024,
    systemPrompt: "test-system",
    availableModels: ["llama3.2"],
  })),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockGenerateOllamaText = jest.mocked(generateOllamaText);
const mockLoadOllamaSettings = jest.mocked(loadOllamaSettings);

const columns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 1,
    uniqueCount: 8,
    sampleValues: [10, 12, 15],
    min: 10,
    max: 42,
    mean: 20,
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AIInsightGenerator tableName="orders" columns={columns} />);
  });
}

describe("AIInsightGenerator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders the generator workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Turn profiled dataset stats into analyst-ready bullet points",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate insights" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy all insights" })).toBeDisabled();
  });

  it("requests insight sections from Ollama and renders each category", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ row_count: 24 }]);
    mockGenerateOllamaText.mockResolvedValue([
      "Trends",
      "- Revenue is rising week over week.",
      "Anomalies",
      "- One row shows a missing revenue value.",
      "Correlations",
      "- Revenue appears aligned with the calendar progression.",
      "Recommendations",
      "- Investigate the missing revenue record before forecasting.",
    ].join("\n"));

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Generate insights" }));

    expect(await screen.findByText("Trends")).toBeInTheDocument();
    expect(
      screen.getByText(/Revenue is rising week over week\./i),
    ).toBeInTheDocument();
    expect(mockLoadOllamaSettings).toHaveBeenCalled();
    expect(mockGenerateOllamaText).toHaveBeenCalled();
  });

  it("copies the generated insight sections to the clipboard", async () => {
    const user = userEvent.setup();
    const writeTextSpy = jest.spyOn(navigator.clipboard, "writeText");

    mockRunQuery.mockResolvedValue([{ row_count: 24 }]);
    mockGenerateOllamaText.mockResolvedValue([
      "Trends",
      "- Revenue is rising week over week.",
      "Anomalies",
      "- One row shows a missing revenue value.",
      "Correlations",
      "- Revenue appears aligned with the calendar progression.",
      "Recommendations",
      "- Investigate the missing revenue record before forecasting.",
    ].join("\n"));

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Generate insights" }));
    await screen.findByText("Trends");

    await user.click(screen.getByRole("button", { name: "Copy all insights" }));

    expect(writeTextSpy).toHaveBeenCalledWith(
      expect.stringContaining("Recommendations"),
    );
  });
});
