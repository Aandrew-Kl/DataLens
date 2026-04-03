import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DataLineageGraph, {
  appendLineageEvent,
  clearLineageEvents,
} from "@/components/data/data-lineage-graph";

jest.mock("framer-motion");

describe("DataLineageGraph", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearLineageEvents("orders");
    jest.clearAllMocks();
  });

  it("renders the empty state when there are no recorded events", () => {
    render(<DataLineageGraph tableName="orders" />);

    expect(screen.getByText("No lineage recorded for orders")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
  });

  it("renders lineage details and lets the user switch the active node", async () => {
    appendLineageEvent("orders", {
      id: "upload-1",
      type: "upload",
      label: "Uploaded orders.csv",
      description: "Imported the raw CSV into DuckDB.",
      rowsBefore: 0,
      rowsAfter: 120,
      timestamp: Date.UTC(2026, 3, 3, 10, 0, 0),
    });

    appendLineageEvent("orders", {
      id: "transform-1",
      type: "transform",
      label: "Trim customer names",
      description: "Removed leading and trailing whitespace from customer_name.",
      sql: 'UPDATE "orders" SET "customer_name" = TRIM("customer_name");',
      sourceTables: ["raw_orders"],
      rowsBefore: 120,
      rowsAfter: 120,
      metadata: { operation: "trim" },
      timestamp: Date.UTC(2026, 3, 3, 10, 15, 0),
    });

    render(<DataLineageGraph tableName="orders" />);

    await waitFor(() => {
      expect(screen.getAllByText("Trim customer names").length).toBeGreaterThan(0);
      expect(
        screen.getByText("Removed leading and trailing whitespace from customer_name."),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          (_, element) =>
            element?.tagName === "PRE" &&
            element.textContent?.includes('"operation": "trim"') === true,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('UPDATE "orders" SET "customer_name" = TRIM("customer_name");'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Uploaded orders\.csv/i }));

    await waitFor(() => {
      expect(screen.getByText("Imported the raw CSV into DuckDB.")).toBeInTheDocument();
    });
  });

  it("exports the current lineage history as JSON", async () => {
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    appendLineageEvent("orders", {
      id: "query-1",
      type: "query",
      label: "Profile dataset",
      description: "Ran a profiling query against orders.",
      rowsBefore: 120,
      rowsAfter: 120,
      timestamp: Date.UTC(2026, 3, 3, 11, 0, 0),
    });

    render(<DataLineageGraph tableName="orders" />);

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    });

    clickSpy.mockRestore();
  });
});
