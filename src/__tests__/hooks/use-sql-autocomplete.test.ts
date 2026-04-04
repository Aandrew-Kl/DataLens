import { renderHook, act, waitFor } from "@testing-library/react";

import { useSQLAutocomplete } from "@/hooks/use-sql-autocomplete";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

const columns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
];

function makeDataset(overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    id: "dataset-1",
    name: "orders",
    fileName: "orders.csv",
    rowCount: 10,
    columnCount: 2,
    columns,
    uploadedAt: 1,
    sizeBytes: 100,
    ...overrides,
  };
}

function mountEditor(value: string, cursor = value.length): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  return textarea;
}

function updateEditor(
  textarea: HTMLTextAreaElement,
  value: string,
  cursor = value.length,
): void {
  textarea.value = value;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  document.dispatchEvent(new Event("selectionchange"));
  document.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  document.dispatchEvent(new Event("focusin"));
}

describe("useSQLAutocomplete", () => {
  beforeEach(() => {
    useDatasetStore.setState({
      datasets: [
        makeDataset({ id: "orders", name: "orders" }),
        makeDataset({ id: "customers", name: "customers", fileName: "customers.csv" }),
      ],
      activeDatasetId: null,
    });
    document.body.innerHTML = "";
  });

  it("returns mixed suggestions even when no text control is active", async () => {
    const { result } = renderHook(() => useSQLAutocomplete("orders", columns));

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const labels = result.current.map((suggestion) => suggestion.label);

    expect(labels).toContain("SELECT");
    expect(labels).toContain("orders");
    expect(labels).toContain("amount");
  });

  it("prefers snippets when the editor is empty", async () => {
    mountEditor("");

    const { result } = renderHook(() => useSQLAutocomplete("orders", columns));

    await waitFor(() => {
      expect(result.current[0]?.category).toBe("snippet");
    });

    expect(result.current[0]?.label).toBe("CTE");
    expect(result.current.some((suggestion) => suggestion.label === "SELECT ... FROM ...")).toBe(
      true,
    );
  });

  it("prioritizes table suggestions after FROM and boosts the current table", async () => {
    mountEditor("SELECT * FROM ");

    const { result } = renderHook(() => useSQLAutocomplete("orders", columns));

    await waitFor(() => {
      expect(result.current[0]?.category).toBe("table");
    });

    expect(result.current[0]).toMatchObject({
      label: "orders",
      insertText: '"orders"',
      category: "table",
    });
  });

  it("prioritizes column suggestions in SELECT clauses", async () => {
    mountEditor("SELECT ");

    const { result } = renderHook(() => useSQLAutocomplete("orders", columns));

    await waitFor(() => {
      expect(result.current[0]?.category).toBe("column");
    });

    expect(result.current[0]?.label).toBe("amount");
    expect(result.current.slice(0, 2).map((suggestion) => suggestion.label)).toEqual([
      "amount",
      "region",
    ]);
  });

  it("updates suggestions when the cursor context changes to a function call", async () => {
    const textarea = mountEditor("SELECT ");
    const { result } = renderHook(() => useSQLAutocomplete("orders", columns));

    await waitFor(() => {
      expect(result.current[0]?.category).toBe("column");
    });

    act(() => {
      updateEditor(textarea, "SELECT COUNT(");
    });

    await waitFor(() => {
      expect(result.current[0]?.category).toBe("function");
    });

    expect(result.current.some((suggestion) => suggestion.label === "COUNT")).toBe(true);
  });

  it("deduplicates table suggestions even when the current table is also in the dataset store", async () => {
    mountEditor("SELECT * FROM ");

    const { result } = renderHook(() => useSQLAutocomplete("orders", columns));

    await waitFor(() => {
      expect(result.current[0]?.category).toBe("table");
    });

    const orderSuggestions = result.current.filter(
      (suggestion) => suggestion.category === "table" && suggestion.label === "orders",
    );

    expect(orderSuggestions).toHaveLength(1);
  });

  it("prioritizes matching column suggestions inside WHERE clauses", async () => {
    mountEditor('SELECT * FROM "orders" WHERE reg');

    const { result } = renderHook(() => useSQLAutocomplete("orders", columns));

    await waitFor(() => {
      expect(result.current[0]?.category).toBe("column");
      expect(result.current[0]?.label).toBe("region");
    });

    expect(result.current.slice(0, 2).map((suggestion) => suggestion.label)).toContain(
      "region",
    );
  });
});
