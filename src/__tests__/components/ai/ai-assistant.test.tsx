import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiAssistant from "@/components/ai/ai-assistant";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 4,
    uniqueCount: 60,
    sampleValues: [120, 240, 360],
    mean: 220,
    median: 210,
    min: 50,
    max: 500,
  },
  {
    name: "region",
    type: "string",
    nullCount: 2,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 64,
    sampleValues: ["2026-01-01", "2026-01-02"],
    min: "2026-01-01",
    max: "2026-03-15",
  },
];

describe("AiAssistant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("opens from the floating button and answers quick prompts", async () => {
    const user = userEvent.setup();

    render(
      <AiAssistant tableName="sales" columns={columns} rowCount={128} />,
    );

    await user.click(
      screen.getByRole("button", { name: /toggle ai assistant/i }),
    );

    expect(screen.getByText("Contextual data help")).toBeInTheDocument();
    expect(screen.getByText("sales • 128 rows • 3 columns")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "How many rows?" }));

    expect(
      await screen.findByText("sales currently has 128 rows."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("handles typed questions and can clear the chat", async () => {
    const user = userEvent.setup();

    render(
      <AiAssistant tableName="sales" columns={columns} rowCount={128} />,
    );

    await user.click(
      screen.getByRole("button", { name: /toggle ai assistant/i }),
    );

    const input = screen.getByPlaceholderText(
      /ask about rows, columns, nulls, quality, or chart suggestions/i,
    );

    fireEvent.change(input, { target: { value: "Describe revenue" } });
    expect(input).toHaveValue("Describe revenue");

    await user.click(screen.getByRole("button", { name: "Describe revenue" }));

    expect(
      await screen.findByText(/revenue is typed as number\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/mean 220/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear chat/i }));

    expect(
      screen.getByText(/I’m watching sales\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/revenue is typed as number/i)).not.toBeInTheDocument();
  });

  it("returns the load-a-dataset guidance when no dataset is active", async () => {
    const user = userEvent.setup();

    render(<AiAssistant />);

    await user.click(
      screen.getByRole("button", { name: /toggle ai assistant/i }),
    );
    await user.click(screen.getByRole("button", { name: "Data quality" }));

    expect(
      await screen.findByText(
        /Load a dataset first, then ask about rows, columns, nulls, data quality, or chart suggestions\./i,
      ),
    ).toBeInTheDocument();
  });
});
