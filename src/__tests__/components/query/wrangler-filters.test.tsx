import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  WranglerFilters,
  buildWranglerOperation,
  getNumericColumns,
  getTextColumns,
  type DateFormState,
  type DedupeFormState,
  type FillFormState,
  type MergeFormState,
  type RegexFormState,
  type SplitFormState,
  type TrimFormState,
} from "@/components/data/wrangler-filters";
import type { OperationType } from "@/components/data/wrangler-toolbar";
import type { ColumnProfile } from "@/types/dataset";

const workingColumns: ColumnProfile[] = [
  {
    name: "full_name",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Ada Lovelace", "Grace Hopper"],
  },
  {
    name: "city",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["London", "New York"],
  },
  {
    name: "score",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [10, 20],
  },
];

const textColumns = getTextColumns(workingColumns);

function WranglerFiltersHarness({
  activeTab,
  busy = false,
  onPreview = jest.fn(),
  onApply = jest.fn(),
}: {
  activeTab: OperationType;
  busy?: boolean;
  onPreview?: jest.Mock;
  onApply?: jest.Mock;
}) {
  const [splitForm, setSplitForm] = useState<SplitFormState>({
    column: "full_name",
    delimiter: ",",
    parts: 2,
    prefix: "full_name_split",
  });
  const [mergeForm, setMergeForm] = useState<MergeFormState>({
    columns: ["full_name", "city"],
    separator: " ",
    output: "merged_column",
  });
  const [fillForm, setFillForm] = useState<FillFormState>({
    column: "score",
    strategy: "constant",
    constantValue: "0",
  });
  const [dateForm, setDateForm] = useState<DateFormState>({
    column: "full_name",
    format: "%Y-%m-%d",
    output: "full_name_parsed",
  });
  const [regexForm, setRegexForm] = useState<RegexFormState>({
    column: "full_name",
    pattern: "",
    groupNames: "group_1",
  });
  const [trimForm, setTrimForm] = useState<TrimFormState>({
    columns: ["full_name"],
  });
  const [dedupeForm, setDedupeForm] = useState<DedupeFormState>({
    columns: ["full_name"],
  });

  return (
    <div>
      <WranglerFilters
        activeTab={activeTab}
        busy={busy}
        workingColumns={workingColumns}
        textColumns={textColumns}
        splitForm={splitForm}
        setSplitForm={setSplitForm}
        mergeForm={mergeForm}
        setMergeForm={setMergeForm}
        fillForm={fillForm}
        setFillForm={setFillForm}
        dateForm={dateForm}
        setDateForm={setDateForm}
        regexForm={regexForm}
        setRegexForm={setRegexForm}
        trimForm={trimForm}
        setTrimForm={setTrimForm}
        dedupeForm={dedupeForm}
        setDedupeForm={setDedupeForm}
        onPreview={onPreview}
        onApply={onApply}
      />

      <pre data-testid="split-form">{JSON.stringify(splitForm)}</pre>
      <pre data-testid="merge-form">{JSON.stringify(mergeForm)}</pre>
      <pre data-testid="fill-form">{JSON.stringify(fillForm)}</pre>
      <pre data-testid="date-form">{JSON.stringify(dateForm)}</pre>
      <pre data-testid="regex-form">{JSON.stringify(regexForm)}</pre>
      <pre data-testid="trim-form">{JSON.stringify(trimForm)}</pre>
      <pre data-testid="dedupe-form">{JSON.stringify(dedupeForm)}</pre>
    </div>
  );
}

describe("WranglerFilters", () => {
  it("updates the split form and triggers preview and apply callbacks", async () => {
    const user = userEvent.setup();
    const onPreview = jest.fn();
    const onApply = jest.fn();

    render(
      <WranglerFiltersHarness
        activeTab="split"
        onPreview={onPreview}
        onApply={onApply}
      />,
    );

    await user.selectOptions(screen.getByLabelText(/source column/i), "city");
    await user.clear(screen.getByLabelText(/delimiter/i));
    await user.type(screen.getByLabelText(/delimiter/i), "|");
    await user.clear(screen.getByLabelText(/parts/i));
    await user.type(screen.getByLabelText(/parts/i), "3");

    expect(screen.getByLabelText(/output prefix/i)).toHaveValue("city_split");
    expect(screen.getByTestId("split-form")).toHaveTextContent(
      '{"column":"city","delimiter":"|","parts":3,"prefix":"city_split"}',
    );

    await user.click(screen.getByRole("button", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: /apply sql transform/i }));

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("toggles merge columns, trim columns, and dedupe keys", async () => {
    const user = userEvent.setup();

    const { rerender } = render(<WranglerFiltersHarness activeTab="merge" />);

    await user.click(screen.getByRole("button", { name: "score" }));
    await user.click(screen.getByRole("button", { name: "city" }));

    expect(screen.getByTestId("merge-form")).toHaveTextContent(
      '{"columns":["full_name","score"],"separator":" ","output":"merged_column"}',
    );

    rerender(<WranglerFiltersHarness activeTab="trim" />);

    await user.click(screen.getByRole("button", { name: "city" }));

    expect(screen.getByTestId("trim-form")).toHaveTextContent(
      '{"columns":["full_name","city"]}',
    );

    rerender(<WranglerFiltersHarness activeTab="dedupe" />);

    await user.click(screen.getByRole("button", { name: "city" }));

    expect(screen.getByTestId("dedupe-form")).toHaveTextContent(
      '{"columns":["full_name","city"]}',
    );
  });

  it("switches fill strategies and updates date and regex forms", async () => {
    const user = userEvent.setup();

    const { rerender } = render(<WranglerFiltersHarness activeTab="fill" />);

    expect(screen.getByLabelText(/constant value/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/strategy/i), "mean");

    expect(screen.queryByLabelText(/constant value/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("fill-form")).toHaveTextContent(
      '{"column":"score","strategy":"mean","constantValue":"0"}',
    );

    rerender(<WranglerFiltersHarness activeTab="dates" />);

    await user.selectOptions(screen.getByLabelText(/source column/i), "city");

    expect(screen.getByLabelText(/output column/i)).toHaveValue("city_parsed");
    expect(screen.getByTestId("date-form")).toHaveTextContent(
      '{"column":"city","format":"%Y-%m-%d","output":"city_parsed"}',
    );

    rerender(<WranglerFiltersHarness activeTab="regex" />);

    await user.type(screen.getByLabelText(/regex pattern/i), "^(\\\\w+)$");
    await user.clear(screen.getByLabelText(/output group names/i));
    await user.type(screen.getByLabelText(/output group names/i), "token");

    expect(screen.getByTestId("regex-form")).toHaveTextContent(
      '{"column":"full_name","pattern":"^(\\\\\\\\w+)$","groupNames":"token"}',
    );
  });

  it("disables apply while busy and builds SQL helpers for the current columns", () => {
    render(<WranglerFiltersHarness activeTab="split" busy />);

    expect(screen.getByRole("button", { name: /apply sql transform/i })).toBeDisabled();

    expect(getTextColumns(workingColumns).map((column) => column.name)).toEqual([
      "full_name",
      "city",
    ]);
    expect(getNumericColumns(workingColumns).map((column) => column.name)).toEqual([
      "score",
    ]);

    expect(
      buildWranglerOperation({
        tableName: "orders",
        workingColumns,
        activeTab: "split",
        splitForm: {
          column: "full_name",
          delimiter: ",",
          parts: 2,
          prefix: "name_part",
        },
        mergeForm: {
          columns: ["full_name", "city"],
          separator: " ",
          output: "merged_column",
        },
        fillForm: {
          column: "score",
          strategy: "constant",
          constantValue: "0",
        },
        dateForm: {
          column: "full_name",
          format: "%Y-%m-%d",
          output: "full_name_parsed",
        },
        regexForm: {
          column: "full_name",
          pattern: "^(.*)$",
          groupNames: "token",
        },
        trimForm: {
          columns: ["full_name"],
        },
        dedupeForm: {
          columns: ["full_name"],
        },
      }),
    ).toMatchObject({
      operation: "split",
      label: 'Split full_name by ","',
      selectSql: expect.stringContaining('split_part(CAST("full_name" AS VARCHAR)'),
      applySql: expect.stringContaining('CREATE OR REPLACE TABLE "orders" AS'),
    });

    expect(() =>
      buildWranglerOperation({
        tableName: "orders",
        workingColumns,
        activeTab: "fill",
        splitForm: {
          column: "full_name",
          delimiter: ",",
          parts: 2,
          prefix: "name_part",
        },
        mergeForm: {
          columns: ["full_name", "city"],
          separator: " ",
          output: "merged_column",
        },
        fillForm: {
          column: "score",
          strategy: "constant",
          constantValue: "not-a-number",
        },
        dateForm: {
          column: "full_name",
          format: "%Y-%m-%d",
          output: "full_name_parsed",
        },
        regexForm: {
          column: "full_name",
          pattern: "^(.*)$",
          groupNames: "token",
        },
        trimForm: {
          columns: ["full_name"],
        },
        dedupeForm: {
          columns: ["full_name"],
        },
      }),
    ).toThrow("Constant fill for numeric columns requires a valid number.");
  });
});
