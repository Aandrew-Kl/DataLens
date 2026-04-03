import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AIDataNarrator from "@/components/ai/ai-data-narrator";
import { generateOllamaText, loadOllamaSettings } from "@/lib/ai/ollama-settings";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/ai/ollama-settings", () => ({
  generateOllamaText: jest.fn(),
  loadOllamaSettings: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockGenerateOllamaText = jest.mocked(generateOllamaText);
const mockLoadOllamaSettings = jest.mocked(loadOllamaSettings);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 12,
    uniqueCount: 40,
    sampleValues: [100, 200, 300],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 4,
    uniqueCount: 38,
    sampleValues: [10, 20, 40],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 1,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB"],
  },
];

async function renderNarrator() {
  await act(async () => {
    render(<AIDataNarrator tableName="sales" columns={columns} />);
  });
}

describe("AIDataNarrator", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockGenerateOllamaText.mockReset();
    mockLoadOllamaSettings.mockReturnValue({
      url: "http://localhost:11434",
      model: "llama3.2",
      temperature: 0.2,
      maxTokens: 1024,
      systemPrompt: "prompt",
      availableModels: ["llama3.2"],
    });
  });

  it("renders the generated narration and summary metrics", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 120 }];
      }

      if (sql.includes("corr(TRY_CAST")) {
        return [{ correlation_value: 0.81, pair_count: 113 }];
      }

      return [];
    });
    mockGenerateOllamaText.mockResolvedValue(
      "Generated summary from Ollama.\n\n- Watch the revenue gaps.\n- Validate the strongest correlation.\n- Review null-heavy fields.",
    );

    await renderNarrator();

    expect(await screen.findByText("Generated summary")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getAllByText("revenue × profit").length).toBeGreaterThan(0);
    expect(screen.getByText(/Generated summary from Ollama/i)).toBeInTheDocument();
  });

  it("switches tone and regenerates the narration prompt", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 120 }];
      }

      if (sql.includes("corr(TRY_CAST")) {
        return [{ correlation_value: 0.81, pair_count: 113 }];
      }

      return [];
    });
    mockGenerateOllamaText
      .mockResolvedValueOnce("Technical summary")
      .mockResolvedValueOnce("Executive summary");

    await renderNarrator();
    await screen.findByText("Technical summary");

    await user.click(screen.getByRole("button", { name: "Executive" }));

    await waitFor(() => {
      expect(mockGenerateOllamaText).toHaveBeenCalledTimes(2);
    });
    expect(mockGenerateOllamaText.mock.calls.at(-1)?.[0].prompt).toContain(
      "executive tone",
    );
  });

  it("renders null hotspot cards from the profiled columns", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 120 }];
      }

      if (sql.includes("corr(TRY_CAST")) {
        return [{ correlation_value: 0.81, pair_count: 113 }];
      }

      return [];
    });
    mockGenerateOllamaText.mockResolvedValue("Narrative with hotspots");

    await renderNarrator();

    expect(await screen.findByText("Narrative with hotspots")).toBeInTheDocument();
    expect(screen.getByText("revenue")).toBeInTheDocument();
    expect(screen.getByText("12 null values detected.")).toBeInTheDocument();
  });

  it("falls back when Ollama generation fails", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 120 }];
      }

      if (sql.includes("corr(TRY_CAST")) {
        return [{ correlation_value: 0.81, pair_count: 113 }];
      }

      return [];
    });
    mockGenerateOllamaText.mockRejectedValue(new Error("Ollama offline"));

    await renderNarrator();

    expect(await screen.findByText("Fallback summary")).toBeInTheDocument();
    expect(screen.getByText("Ollama offline")).toBeInTheDocument();
  });
});
