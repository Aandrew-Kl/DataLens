import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AIDataCleaner from "@/components/ai/ai-data-cleaner";
import { runQuery } from "@/lib/duckdb/client";
import { generateOllamaText } from "@/lib/ai/ollama-settings";
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

const columns: ColumnProfile[] = [
  {
    name: "customer_segment",
    type: "string",
    nullCount: 2,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "enterprise ", "SMB"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 1,
    uniqueCount: 8,
    sampleValues: [10, 12, 15],
    mean: 14,
    median: 13,
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AIDataCleaner tableName="orders" columns={columns} />);
  });
}

describe("AIDataCleaner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the cleaning overview before scanning", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Detect data quality issues and apply local cleaning actions",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Detect quality issues" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Run the scan to generate cleaning suggestions/i),
    ).toBeInTheDocument();
  });

  it("builds cleaning suggestions from the scan and Ollama notes", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ column_name: "revenue", outlier_count: 2 }]);
    mockGenerateOllamaText.mockResolvedValue([
      "- Fill missing numeric values first.",
      "- Standardize text labels before grouping.",
      "- Cap outliers that distort the range.",
    ].join("\n"));

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Detect quality issues" }));

    expect(await screen.findByText("Fill missing values in revenue")).toBeInTheDocument();
    expect(screen.getByText("Trim and normalize customer_segment")).toBeInTheDocument();
    expect(screen.getByText("Cap extreme values in revenue")).toBeInTheDocument();
  });

  it("applies a generated suggestion through DuckDB", async () => {
    const user = userEvent.setup();

    mockRunQuery
      .mockResolvedValueOnce([{ column_name: "revenue", outlier_count: 2 }])
      .mockResolvedValueOnce([]);
    mockGenerateOllamaText.mockResolvedValue([
      "- Fill missing numeric values first.",
      "- Standardize text labels before grouping.",
      "- Cap outliers that distort the range.",
    ].join("\n"));

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Detect quality issues" }));
    await screen.findByText("Fill missing values in revenue");

    await user.click(screen.getAllByRole("button", { name: "Apply via DuckDB" })[2]);

    expect(mockRunQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE "orders" SET "revenue" = 13'),
    );
    expect(await screen.findByText(/Applied:/i)).toBeInTheDocument();
  });
});
