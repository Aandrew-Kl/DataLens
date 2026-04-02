import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TemplatePicker from "@/components/query/template-picker";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

const columns: ColumnProfile[] = [
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Enterprise", "SMB"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [10, 20],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: ["2025-01-01", "2025-01-02"],
  },
];

describe("TemplatePicker", () => {
  it("filters templates down to an empty state", () => {
    render(
      <TemplatePicker
        tableName="orders"
        columns={columns}
        onSelectSQL={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search templates..."), {
      target: { value: "missing template" },
    });

    expect(screen.getByText("No templates found")).toBeInTheDocument();
  });

  it("configures a template and returns the rendered SQL", async () => {
    const user = userEvent.setup();
    const onSelectSQL = jest.fn();

    render(
      <TemplatePicker
        tableName="orders"
        columns={columns}
        onSelectSQL={onSelectSQL}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Filter by Value/i }));

    const valueInput = screen.getByPlaceholderText("some value");
    fireEvent.change(valueInput, {
      target: { value: "Enterprise" },
    });

    expect(document.querySelector("pre")?.textContent).toContain(
      'WHERE "segment" = \'Enterprise\';',
    );

    await user.click(screen.getByRole("button", { name: /Use This Query/i }));

    expect(onSelectSQL).toHaveBeenCalledWith(
      'SELECT *\nFROM "orders"\nWHERE "segment" = \'Enterprise\';',
    );
  });
});
