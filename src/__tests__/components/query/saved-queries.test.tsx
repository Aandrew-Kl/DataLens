import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SavedQueries from "@/components/query/saved-queries";

jest.mock("framer-motion");

const STORAGE_KEY = "datalens-saved-queries";

function seedSavedQueries(payload: unknown) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

describe("SavedQueries", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    Object.defineProperty(window, "confirm", {
      configurable: true,
      writable: true,
      value: jest.fn(() => true),
    });
  });

  it("creates a saved query and reuses it", async () => {
    const user = userEvent.setup();
    const onSelectQuery = jest.fn();

    render(<SavedQueries onSelectQuery={onSelectQuery} />);

    await user.click(screen.getByRole("button", { name: /^Save query$/i }));
    fireEvent.change(screen.getByPlaceholderText("Revenue by month"), {
      target: { value: "Revenue by month" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Short note about what this query answers."),
      { target: { value: "Monthly revenue rollup." } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("finance, monthly, executive"),
      { target: { value: "Finance, Monthly" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("SELECT * FROM orders LIMIT 100;"),
      {
        target: {
          value: 'SELECT month, SUM(amount) FROM "sales" GROUP BY month;',
        },
      },
    );

    await user.click(screen.getAllByRole("button", { name: /^Save query$/i })[1]);

    expect(await screen.findByText("Saved query added.")).toBeInTheDocument();
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as Array<{ name: string; tags: string[] }>;
    expect(stored[0]?.name).toBe("Revenue by month");
    expect(stored[0]?.tags).toEqual(["finance", "monthly"]);

    await user.click(screen.getByRole("button", { name: /Use query/i }));
    expect(onSelectQuery).toHaveBeenCalledWith(
      'SELECT month, SUM(amount) FROM "sales" GROUP BY month;',
    );
  });

  it("edits an existing query and deletes it after confirmation", async () => {
    const user = userEvent.setup();

    seedSavedQueries([
      {
        id: "query-1",
        name: "Revenue summary",
        description: "Old description",
        tags: ["finance"],
        sql: 'SELECT SUM(amount) FROM "sales";',
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
    ]);

    render(<SavedQueries onSelectQuery={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /Edit Revenue summary/i }));
    const nameInput = screen.getByDisplayValue("Revenue summary");
    fireEvent.change(nameInput, {
      target: { value: "Updated revenue summary" },
    });
    await user.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "[]",
      ) as Array<{ name: string }>;
      expect(stored[0]?.name).toBe("Updated revenue summary");
    });

    await user.click(
      screen.getByRole("button", { name: /Delete Updated revenue summary/i }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Updated revenue summary")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");
  });

  it("exports saved queries and reports invalid imports", async () => {
    const user = userEvent.setup();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    seedSavedQueries([
      {
        id: "query-1",
        name: "Revenue summary",
        description: "",
        tags: [],
        sql: 'SELECT SUM(amount) FROM "sales";',
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      },
    ]);

    const { container } = render(<SavedQueries onSelectQuery={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /^Export$/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Saved queries exported.")).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const invalidFile = new File(["{}"], "queries.json", {
      type: "application/json",
    });
    Object.defineProperty(invalidFile, "text", {
      configurable: true,
      value: jest.fn().mockResolvedValue("{}"),
    });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(
      await screen.findByText(
        "The imported file must contain an array of saved queries.",
      ),
    ).toBeInTheDocument();

    clickSpy.mockRestore();
  });
});
