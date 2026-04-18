import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QueryHistory from "@/components/query/query-history";
import { useQueryStore } from "@/stores/query-store";

jest.mock("framer-motion");

describe("QueryHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useQueryStore.setState({
      history: [],
      lastResult: null,
      isQuerying: false,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders the empty state when there is no history for a dataset", () => {
    render(<QueryHistory datasetId="sales" onSelectQuery={jest.fn()} />);

    expect(screen.getByText("No query history yet")).toBeInTheDocument();
  });

  it("filters, reuses, deletes, and clears dataset history", async () => {
    const user = userEvent.setup();
    const now = Date.now();

    useQueryStore.setState({
      history: [
        {
          id: "1",
          question: "Revenue by region",
          sql: 'SELECT region, SUM(amount) FROM "sales"',
          datasetId: "sales",
          createdAt: now,
        },
        {
          id: "2",
          question: "Profit by segment",
          sql: 'SELECT segment, SUM(profit) FROM "sales"',
          datasetId: "sales",
          createdAt: now - 60_000,
        },
        {
          id: "3",
          question: "Inventory overview",
          sql: 'SELECT * FROM "inventory"',
          datasetId: "inventory",
          createdAt: now - 120_000,
        },
      ],
      lastResult: null,
      isQuerying: false,
    });

    const onSelectQuery = jest.fn();
    render(<QueryHistory datasetId="sales" onSelectQuery={onSelectQuery} />);

    await user.click(screen.getByText("Revenue by region"));
    expect(onSelectQuery).toHaveBeenCalledWith(
      'SELECT region, SUM(amount) FROM "sales"',
    );

    fireEvent.change(
      screen.getByPlaceholderText("Search questions or SQL..."),
      { target: { value: "profit" } },
    );

    await waitFor(() => {
      expect(screen.getByText("Profit by segment")).toBeInTheDocument();
      expect(screen.queryByText("Revenue by region")).not.toBeInTheDocument();
    });

    fireEvent.change(
      screen.getByPlaceholderText("Search questions or SQL..."),
      { target: { value: "" } },
    );

    await user.click(screen.getByRole("button", { name: /Delete Revenue by region/i }));
    expect(screen.queryByText("Revenue by region")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Clear all/i }));
    expect(useQueryStore.getState().history).toEqual([
      expect.objectContaining({ datasetId: "inventory" }),
    ]);
  });
});
