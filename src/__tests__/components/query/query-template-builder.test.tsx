import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QueryTemplateBuilder from "@/components/query/query-template-builder";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));

const columns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["open", "closed"],
  },
];

let mockWriteText: jest.Mock;

async function renderAsync() {
  await act(async () => {
    render(<QueryTemplateBuilder tableName="orders" columns={columns} />);
  });
}

describe("QueryTemplateBuilder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: mockWriteText,
      },
    });
    void runQuery;
  });

  it("renders parameter inputs and updates the SQL preview", async () => {
    await renderAsync();
    fireEvent.change(screen.getByLabelText("SQL template"), {
      target: {
        value: "SELECT * FROM {{table_name}} WHERE {{filter_clause}} LIMIT {{limit}};",
      },
    });
    fireEvent.change(screen.getByLabelText("filter_clause"), {
      target: { value: "status = 'open'" },
    });

    expect(screen.getByText(/SELECT \* FROM orders WHERE status = 'open' LIMIT 100;/i)).toBeInTheDocument();
  });

  it("saves templates to localStorage and reloads them from the saved list", async () => {
    const user = userEvent.setup();

    await renderAsync();
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Status slice" },
    });
    await user.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("datalens:query-template-builder")).toContain("Status slice");
    });

    expect(screen.getByRole("button", { name: /Status slice/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Status slice/i }));
    expect(screen.getByText("Loaded Status slice.")).toBeInTheDocument();
  });

  it("copies the rendered SQL to the clipboard", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Copy SQL" }));

    expect(await screen.findByText("SQL copied to clipboard.")).toBeInTheDocument();
  });
});
