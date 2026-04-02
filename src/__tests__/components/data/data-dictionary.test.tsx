import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataDictionary from "@/components/data/data-dictionary";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;
const STORAGE_KEY = "datalens:data-dictionary:orders";

const dictionaryColumns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 1,
    uniqueCount: 3,
    sampleValues: ["active", "paused", "archived"],
  },
  {
    name: "amount",
    type: "unknown",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["10", "20", "30"],
    min: 10,
    max: 30,
    mean: 20,
    median: 20,
  },
  {
    name: "created_at",
    type: "unknown",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["2024-01-01", "2024-01-02"],
    min: "2024-01-01",
    max: "2024-01-04",
  },
];

describe("DataDictionary", () => {
  beforeEach(() => {
    mockDownloadFile.mockReset();
    window.localStorage.clear();
  });

  it("detects column types and filters rows by type and search query", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status: "Lifecycle state for the order." }),
    );

    render(
      <DataDictionary
        tableName="orders"
        columns={dictionaryColumns}
        rowCount={6}
      />,
    );

    expect(screen.getByRole("button", { name: "Number (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date (1)" })).toBeInTheDocument();
    expect(screen.getByText("Lifecycle state for the order.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Number (1)" }));
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.queryByText("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All (3)" }));
    await user.clear(
      screen.getByPlaceholderText("Search columns, descriptions, or types..."),
    );
    await user.type(
      screen.getByPlaceholderText("Search columns, descriptions, or types..."),
      "lifecycle",
    );

    await waitFor(() => {
      expect(screen.getByText("status")).toBeInTheDocument();
    });
    expect(screen.queryByText("amount")).not.toBeInTheDocument();
  });

  it("edits descriptions and persists them to local storage", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <DataDictionary
        tableName="orders"
        columns={dictionaryColumns}
        rowCount={6}
      />,
    );

    fireEvent.click(screen.getByText("amount"));

    const descriptionField = await screen.findByPlaceholderText(
      "Document what amount represents, business rules, and caveats.",
    );
    fireEvent.change(descriptionField, {
      target: { value: "Net revenue amount" },
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain(
        '"amount":"Net revenue amount"',
      );
    });

    unmount();

    render(
      <DataDictionary
        tableName="orders"
        columns={dictionaryColumns}
        rowCount={6}
      />,
    );

    expect(screen.getByText("Net revenue amount")).toBeInTheDocument();
  });

  it("exports the dictionary as JSON and Markdown", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status: "Lifecycle state for the order." }),
    );

    render(
      <DataDictionary
        tableName="orders"
        columns={dictionaryColumns}
        rowCount={6}
      />,
    );

    await user.click(screen.getByRole("button", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "Markdown" }));

    expect(mockDownloadFile).toHaveBeenCalledTimes(2);

    const [jsonContent, jsonFilename, jsonMime] = mockDownloadFile.mock.calls[0];
    const [markdownContent, markdownFilename, markdownMime] =
      mockDownloadFile.mock.calls[1];

    expect(jsonFilename).toBe("orders-data-dictionary.json");
    expect(jsonMime).toBe("application/json;charset=utf-8;");
    expect(JSON.parse(String(jsonContent))).toEqual(
      expect.objectContaining({
        tableName: "orders",
        rowCount: 6,
        columns: expect.arrayContaining([
          expect.objectContaining({
            name: "status",
            description: "Lifecycle state for the order.",
            type: "string",
          }),
        ]),
      }),
    );

    expect(markdownFilename).toBe("orders-data-dictionary.md");
    expect(markdownMime).toBe("text/markdown;charset=utf-8;");
    expect(String(markdownContent)).toContain("# Data Dictionary: orders");
    expect(String(markdownContent)).toContain("## status");
    expect(String(markdownContent)).toContain(
      "- Description: Lifecycle state for the order.",
    );
  });
});
