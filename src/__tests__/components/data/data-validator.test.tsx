import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataValidator from "@/components/data/data-validator";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const validatorColumns: ColumnProfile[] = [
  {
    name: "email",
    type: "string",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: ["a@example.com", "bad-email"],
  },
  {
    name: "age",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [22, 35, 41],
    min: 18,
    max: 65,
    mean: 33.5,
    median: 34,
  },
];

describe("DataValidator", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("warns when a configured rule is incomplete", async () => {
    const user = userEvent.setup();

    render(
      <DataValidator
        tableName="customers"
        columns={[validatorColumns[1]]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add rule/i }));
    await user.selectOptions(screen.getByRole("combobox"), "range");

    expect(
      await screen.findByText(
        "age: Range rules need a minimum, maximum, or both.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run validation/i })).toBeDisabled();
  });

  it("runs validation tasks, shows violations, and renders passing checks", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (
        sql.includes("COUNT(*) AS violations") &&
        sql.includes("NOT regexp_matches")
      ) {
        return [{ violations: 2 }];
      }

      if (sql.includes("NOT regexp_matches") && sql.includes("LIMIT 5")) {
        return [
          { email: "bad-email", age: 22 },
          { email: "still_bad", age: 35 },
        ];
      }

      if (sql.includes('COUNT(*) AS violations FROM "customers" WHERE "age" IS NULL')) {
        return [{ violations: 0 }];
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    render(<DataValidator tableName="customers" columns={validatorColumns} />);

    const [emailAddButton, ageAddButton] = screen.getAllByRole("button", {
      name: /add rule/i,
    });

    await user.click(emailAddButton);
    await user.selectOptions(screen.getByRole("combobox"), "regex");
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
    });

    await user.click(ageAddButton);
    await user.click(screen.getByRole("button", { name: /run validation/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining("regexp_matches"),
      );
    });
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE "age" IS NULL'),
    );

    expect(await screen.findByText("email · Regex pattern")).toBeInTheDocument();
    expect(screen.getByText("age · Not null")).toBeInTheDocument();
    expect(screen.getByText("bad-email")).toBeInTheDocument();
    expect(screen.getByText("still_bad")).toBeInTheDocument();
    expect(screen.getByText("No violating rows were found.")).toBeInTheDocument();
    expect(screen.getByText("Failures")).toBeInTheDocument();
    expect(screen.getByText("Total violations")).toBeInTheDocument();
  });

  it("surfaces execution errors from DuckDB", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Validation blew up"));

    render(
      <DataValidator
        tableName="customers"
        columns={[validatorColumns[0]]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add rule/i }));
    await user.click(screen.getByRole("button", { name: /run validation/i }));

    expect(await screen.findByText("Validation blew up")).toBeInTheDocument();
  });
});
