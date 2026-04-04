import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AIAnomalyExplainer from "@/components/ai/ai-anomaly-explainer";
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
let clipboardWriteText = jest.fn<Promise<void>, [string]>();

const numericColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 200],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B"],
  },
];

async function renderExplainer(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(
      <AIAnomalyExplainer tableName="orders" columns={targetColumns} />,
    );
  });
}

describe("AIAnomalyExplainer", () => {
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
    clipboardWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  it("renders anomaly cards with AI explanations", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (
        sql.includes('CAST("amount" AS DOUBLE) AS metric') &&
        sql.includes("lower_bound")
      ) {
        return [
          {
            q1: 10,
            median_value: 12,
            q3: 14,
            iqr: 4,
            lower_bound: 4,
            upper_bound: 20,
          },
        ];
      }

      if (sql.includes('CAST("amount" AS DOUBLE) AS __metric')) {
        return [
          {
            order_id: 99,
            customer_id: 12,
            category: "B",
            amount: 125,
            __metric: 125,
          },
        ];
      }

      return [];
    });
    mockGenerateOllamaText.mockResolvedValue(
      "- Rare high payment\n- Could be a one-off enterprise renewal\n- Verify invoice lineage",
    );

    await renderExplainer(numericColumns);

    expect(await screen.findByText("Value 125.00")).toBeInTheDocument();
    expect(screen.getByText(/Rare high payment/i)).toBeInTheDocument();
    expect(screen.getByText("customer_id")).toBeInTheDocument();
  });

  it("copies an explanation to the clipboard", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (
        sql.includes('CAST("amount" AS DOUBLE) AS metric') &&
        sql.includes("lower_bound")
      ) {
        return [
          {
            q1: 10,
            median_value: 12,
            q3: 14,
            iqr: 4,
            lower_bound: 4,
            upper_bound: 20,
          },
        ];
      }

      if (sql.includes('CAST("amount" AS DOUBLE) AS __metric')) {
        return [
          {
            order_id: 99,
            customer_id: 12,
            category: "B",
            amount: 125,
            __metric: 125,
          },
        ];
      }

      return [];
    });
    mockGenerateOllamaText.mockResolvedValue("Copy this explanation");

    await renderExplainer(numericColumns);
    await screen.findByText("Copy this explanation");

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shows an empty state when there are no numeric columns", async () => {
    await renderExplainer([
      {
        name: "status",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["new", "won"],
      },
    ]);

    expect(
      screen.getByText("Add at least one numeric column to explain anomalies."),
    ).toBeInTheDocument();
  });

  it("falls back to deterministic explanations when Ollama fails", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (
        sql.includes('CAST("amount" AS DOUBLE) AS metric') &&
        sql.includes("lower_bound")
      ) {
        return [
          {
            q1: 10,
            median_value: 12,
            q3: 14,
            iqr: 4,
            lower_bound: 4,
            upper_bound: 20,
          },
        ];
      }

      if (sql.includes('CAST("amount" AS DOUBLE) AS __metric')) {
        return [
          {
            order_id: 99,
            customer_id: 12,
            category: "B",
            amount: 125,
            __metric: 125,
          },
        ];
      }

      return [];
    });
    mockGenerateOllamaText.mockRejectedValue(new Error("generation failed"));

    await renderExplainer(numericColumns);

    expect(await screen.findByText(/Fallback explanation:/i)).toBeInTheDocument();
    expect(screen.getByText("generation failed")).toBeInTheDocument();
  });
});
