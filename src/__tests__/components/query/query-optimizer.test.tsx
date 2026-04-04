import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

import QueryOptimizer from "@/components/query/query-optimizer";
import type { ColumnProfile } from "@/types/dataset";

const columns: ColumnProfile[] = [
  { name: "id", type: "number", nullable: false, unique: 100 },
  { name: "name", type: "string", nullable: false, unique: 80 },
  { name: "created_at", type: "date", nullable: true, unique: 50 },
] as ColumnProfile[];

describe("QueryOptimizer", () => {
  it("renders heading and default query with anti-pattern cards", async () => {
    await act(async () => {
      render(<QueryOptimizer tableName="users" columns={columns} />);
    });

    expect(screen.getByText("Query Optimizer")).toBeInTheDocument();
    expect(
      screen.getByText("Spot common SQL anti-patterns before they hit DuckDB"),
    ).toBeInTheDocument();
    // Default query is SELECT * ... ORDER BY 1 DESC; which triggers select-star + order-by-without-limit
    expect(
      screen.getByText("Replace SELECT * with an explicit projection"),
    ).toBeInTheDocument();
  });

  it("shows severity count cards for info, warnings, errors", async () => {
    await act(async () => {
      render(<QueryOptimizer tableName="users" columns={columns} />);
    });

    expect(screen.getByText("Info")).toBeInTheDocument();
    expect(screen.getByText("Warnings")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
  });

  it("applies a rewrite when clicking the Use rewrite button", async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<QueryOptimizer tableName="users" columns={columns} />);
    });

    // Default query triggers select-star warning
    expect(
      screen.getByText("Replace SELECT * with an explicit projection"),
    ).toBeInTheDocument();

    const useRewriteButtons = screen.getAllByText("Use rewrite");
    await user.click(useRewriteButtons[0]);

    // After applying the select-star rewrite, the SELECT * warning disappears
    expect(
      screen.queryByText("Replace SELECT * with an explicit projection"),
    ).not.toBeInTheDocument();
  });

  it("resets to sample query when clicking Reset sample query", async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<QueryOptimizer tableName="users" columns={columns} />);
    });

    // Apply a rewrite first
    await user.click(screen.getAllByText("Use rewrite")[0]);

    // Reset
    await user.click(screen.getByText("Reset sample query"));
    // After reset, the original anti-patterns should reappear
    expect(
      screen.getByText("Replace SELECT * with an explicit projection"),
    ).toBeInTheDocument();
  });
});
