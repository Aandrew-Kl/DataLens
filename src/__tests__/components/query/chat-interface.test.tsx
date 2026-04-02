import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ChatInterface from "@/components/query/chat-interface";
import { runQuery } from "@/lib/duckdb/client";
import { useQueryStore } from "@/stores/query-store";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));
jest.mock("@/components/data/data-table", () => ({
  __esModule: true,
  default: ({
    data,
    columns,
  }: {
    data: Record<string, unknown>[];
    columns: string[];
  }) =>
    React.createElement(
      "div",
      { "data-testid": "data-table" },
      `${columns.join(",")}:${data.length} rows`,
    ),
}));
jest.mock("@/components/charts/chart-renderer", () => ({
  __esModule: true,
  default: ({ config }: { config: { title?: string } }) =>
    React.createElement(
      "div",
      { "data-testid": "chart-renderer" },
      config.title ?? "",
    ),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [10, 20, 30],
  },
];

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("ChatInterface", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    useQueryStore.setState({
      history: [],
      lastResult: null,
      isQuerying: false,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  it("loads suggestions, runs a generated query, and stores the result", async () => {
    const user = userEvent.setup();
    const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ questions: ["How many rows are in orders?"] }),
      )
      .mockResolvedValueOnce(jsonResponse({ sql: "SELECT 1 AS total" }))
      .mockResolvedValueOnce(
        jsonResponse({
          sql: '{"type":"bar","title":"Orders","xAxis":"label","yAxis":"value"}',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ sql: "There is one matching row." }));

    mockRunQuery.mockResolvedValue([{ total: 1 }]);

    render(
      <ChatInterface
        datasetId="orders-dataset"
        tableName="orders"
        columns={columns}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: /How many rows are in orders\?/i,
      }),
    );

    expect(await screen.findByText("There is one matching row.")).toBeInTheDocument();
    expect(screen.getByTestId("chart-renderer")).toHaveTextContent("Orders");
    expect(screen.getByTestId("data-table")).toHaveTextContent("total:1 rows");

    await waitFor(() => {
      expect(useQueryStore.getState().history).toHaveLength(1);
      expect(useQueryStore.getState().lastResult?.sql).toBe("SELECT 1 AS total");
    });
  });

  it("renders the assistant error state when SQL generation fails", async () => {
    const user = userEvent.setup();
    const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false));

    render(
      <ChatInterface
        datasetId="orders-dataset"
        tableName="orders"
        columns={columns}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText("Loading suggestions..."),
      ).not.toBeInTheDocument();
    });

    await user.type(
      screen.getByPlaceholderText("Ask anything about your data..."),
      "Show me totals",
    );
    await user.click(screen.getByRole("button"));

    expect(
      await screen.findByText("Failed to generate SQL. Is Ollama running?"),
    ).toBeInTheDocument();
  });
});
