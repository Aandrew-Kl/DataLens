import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiSchemaAnalyzer from "@/components/ai/ai-schema-analyzer";
import {
  checkOllamaConnection,
  generateOllamaText,
  loadOllamaSettings,
} from "@/lib/ai/ollama-settings";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));
jest.mock("@/lib/ai/ollama-settings", () => ({
  checkOllamaConnection: jest.fn(),
  generateOllamaText: jest.fn(),
  loadOllamaSettings: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);
const mockCheckOllamaConnection = jest.mocked(checkOllamaConnection);
const mockGenerateOllamaText = jest.mocked(generateOllamaText);
const mockLoadOllamaSettings = jest.mocked(loadOllamaSettings);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [100, 120],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB"],
  },
  {
    name: "order_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [1, 2],
  },
  {
    name: "customer_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["c1", "c2"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AiSchemaAnalyzer tableName="sales" columns={columns} />);
  });
}

describe("AiSchemaAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadOllamaSettings.mockReturnValue({
      url: "http://localhost:11434",
      model: "llama3.2",
      temperature: 0.2,
      maxTokens: 2048,
      systemPrompt: "Keep it concise.",
      availableModels: ["llama3.2"],
    });
  });

  it("renders the initial analyzer state with export disabled", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Explain the table structure, relationship hints, and schema risks",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Run the analyzer to generate an AI-backed schema summary."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export markdown" })).toBeDisabled();
  });

  it("runs the schema analysis with Ollama-backed summary generation", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { column_name: "revenue", column_type: "DOUBLE" },
      { column_name: "created_at", column_type: "TIMESTAMP" },
      { column_name: "segment", column_type: "VARCHAR" },
      { column_name: "order_id", column_type: "BIGINT" },
      { column_name: "customer_id", column_type: "VARCHAR" },
    ]);
    mockCheckOllamaConnection.mockResolvedValue({
      kind: "connected",
      message: "Connected. 1 model available.",
      models: ["llama3.2"],
    });
    mockGenerateOllamaText.mockResolvedValue(
      "Sales combines daily revenue, segmentation, and join-ready identifiers.",
    );

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze schema" }));

    expect(
      await screen.findByText(
        "Sales combines daily revenue, segmentation, and join-ready identifiers.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/created_at can anchor time-series analysis/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/order_id, customer_id look like join-friendly identifiers/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No immediate naming or typing issues were detected from the current schema profile."),
    ).toBeInTheDocument();
  });

  it("falls back to the local summary when Ollama is unavailable and exports markdown", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([]);
    mockCheckOllamaConnection.mockResolvedValue({
      kind: "error",
      message: "Ollama is offline.",
      models: [],
    });

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze schema" }));

    expect(
      await screen.findByText("sales contains 5 columns.", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ollama is offline. Using a local fallback summary instead."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export markdown" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("# Schema analysis for sales"),
      "sales-schema-analysis.md",
      "text/markdown;charset=utf-8;",
    );
    expect(mockGenerateOllamaText).not.toHaveBeenCalled();
  });

  it("surfaces schema loading failures", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Describe failed"));

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze schema" }));

    expect(await screen.findByText("Describe failed")).toBeInTheDocument();
  });
});
