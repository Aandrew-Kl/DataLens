import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataImportPreview from "@/components/data/data-import-preview";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

const columns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2, 3],
  },
  {
    name: "name",
    type: "string",
    nullCount: 1,
    uniqueCount: 8,
    sampleValues: ["a", "b"],
  },
  {
    name: "value",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1.5, 2.5],
  },
];

function createDelimitedFile(name: string, contents: string) {
  const file = new File([contents], name, { type: "text/csv" });

  Object.defineProperty(file, "text", {
    configurable: true,
    value: jest.fn().mockResolvedValue(contents),
  });

  return file;
}

describe("DataImportPreview", () => {
  it("ignores option changes before upload and empty file selections", async () => {
    const user = userEvent.setup();

    render(<DataImportPreview tableName="orders" columns={columns} />);

    const delimiterSelect = screen.getByRole("combobox", { name: /delimiter/i });
    expect(delimiterSelect).toHaveValue(",");

    await user.selectOptions(delimiterSelect, ";");
    expect(delimiterSelect).toHaveValue(",");

    fireEvent.change(screen.getByLabelText(/upload delimited file/i), {
      target: { files: [] },
    });

    expect(
      screen.getByRole("heading", {
        name: /inspect import settings before loading into orders/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("detects UTF-8 BOM uploads", async () => {
    const user = userEvent.setup();

    render(<DataImportPreview tableName="orders" columns={columns} />);

    const file = createDelimitedFile(
      "bom.csv",
      "\ufeffname,value\nAlpha,1\nBeta,2",
    );

    await user.upload(screen.getByLabelText(/upload delimited file/i), file);

    expect(await screen.findByText(/loaded preview for bom\.csv\./i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /encoding/i })).toHaveValue("utf-8-bom");
  });

  it("detects delimiter and infers string, number, boolean, date, and unknown columns", async () => {
    const user = userEvent.setup();

    render(<DataImportPreview tableName="orders" columns={columns} />);

    const file = createDelimitedFile(
      "types.csv",
      [
        "name;amount;active;created;notes;optional",
        'Anaïs;12.5;yes;2024-01-01;"has ""quote""; note";',
        'Björk;7;no;2024-01-02;"second; note";',
      ].join("\n"),
    );

    await user.upload(screen.getByLabelText(/upload delimited file/i), file);

    expect(await screen.findByText(/loaded preview for types\.csv\./i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /delimiter/i })).toHaveValue(";");
    expect(screen.getByRole("combobox", { name: /encoding/i })).toHaveValue("utf-8");
    expect(screen.getByRole("combobox", { name: /header row/i })).toHaveValue("true");
    expect(screen.getByRole("combobox", { name: /type override for name/i })).toHaveValue("string");
    expect(screen.getByRole("combobox", { name: /type override for amount/i })).toHaveValue("number");
    expect(screen.getByRole("combobox", { name: /type override for active/i })).toHaveValue("boolean");
    expect(screen.getByRole("combobox", { name: /type override for created/i })).toHaveValue("date");
    expect(screen.getByRole("combobox", { name: /type override for notes/i })).toHaveValue("string");
    expect(screen.getByRole("combobox", { name: /type override for optional/i })).toHaveValue("unknown");

    await user.selectOptions(
      screen.getByRole("combobox", { name: /type override for optional/i }),
      "string",
    );
    expect(screen.getByRole("combobox", { name: /type override for optional/i })).toHaveValue("string");

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
    expect(within(table).getByRole("cell", { name: 'has "quote"; note' })).toBeInTheDocument();
    expect(within(table).getAllByRole("cell", { name: "—" })).toHaveLength(2);
  });

  it("autogenerates headers for headerless files and lets users toggle the header-row option", async () => {
    const user = userEvent.setup();

    render(<DataImportPreview tableName="orders" columns={columns} />);

    const file = createDelimitedFile(
      "headerless.txt",
      ["1|2024-01-01|true", "2|2024-01-02|false"].join("\n"),
    );

    await user.upload(screen.getByLabelText(/upload delimited file/i), file);

    const headerRowSelect = screen.getByRole("combobox", { name: /header row/i });
    expect(screen.getByRole("combobox", { name: /delimiter/i })).toHaveValue("|");
    expect(headerRowSelect).toHaveValue("false");
    expect(screen.getByRole("combobox", { name: /type override for column 1/i })).toHaveValue("number");
    expect(screen.getByRole("combobox", { name: /type override for column 2/i })).toHaveValue("date");
    expect(screen.getByRole("combobox", { name: /type override for column 3/i })).toHaveValue("boolean");

    let table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Column 1" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Column 2" })).toBeInTheDocument();

    await user.selectOptions(headerRowSelect, "true");

    table = screen.getByRole("table");
    expect(headerRowSelect).toHaveValue("true");
    expect(within(table).getByRole("columnheader", { name: "1" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "2024-01-01" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "true" })).toBeInTheDocument();
  });

  it("renders an empty preview for empty uploads", async () => {
    const user = userEvent.setup();

    render(<DataImportPreview tableName="orders" columns={columns} />);

    await user.upload(
      screen.getByLabelText(/upload delimited file/i),
      createDelimitedFile("empty.csv", ""),
    );

    expect(await screen.findByText(/loaded preview for empty\.csv\./i)).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).queryAllByRole("columnheader")).toHaveLength(0);
    expect(within(table).queryAllByRole("cell")).toHaveLength(0);
    expect(
      screen.queryByRole("combobox", { name: /type override for/i }),
    ).not.toBeInTheDocument();
  });

  it("truncates large datasets to the first 100 data rows", async () => {
    const user = userEvent.setup();

    render(<DataImportPreview tableName="orders" columns={columns} />);

    const rows = Array.from({ length: 101 }, (_, index) => `${index + 1},value-${index + 1}`);
    const file = createDelimitedFile("large.csv", ["id,label", ...rows].join("\n"));

    await user.upload(screen.getByLabelText(/upload delimited file/i), file);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    expect(within(table).getByRole("cell", { name: "value-100" })).toBeInTheDocument();
    expect(within(table).queryByRole("cell", { name: "value-101" })).not.toBeInTheDocument();
  });
});
