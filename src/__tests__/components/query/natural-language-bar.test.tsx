import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NaturalLanguageBar from "@/components/query/natural-language-bar";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 20],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["West", "East"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["2025-01-01"],
  },
];

describe("NaturalLanguageBar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("submits a suggested question and stores it in recent queries", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <NaturalLanguageBar
        tableName="orders"
        columns={columns}
        onSubmit={onSubmit}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "What is the average revenue in orders?",
      }),
    );

    expect(onSubmit).toHaveBeenCalledWith(
      "What is the average revenue in orders?",
    );
    expect(
      JSON.parse(
        window.localStorage.getItem("datalens:nlq-recent:orders") ?? "[]",
      ),
    ).toEqual(["What is the average revenue in orders?"]);
  });

  it("shows recent queries and resubmits one from the dropdown", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    window.localStorage.setItem(
      "datalens:nlq-recent:orders",
      JSON.stringify(["Summarize the key patterns in orders."]),
    );

    render(
      <NaturalLanguageBar
        tableName="orders"
        columns={columns}
        onSubmit={onSubmit}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /Recent/i }));
    await user.click(
      await screen.findByRole("button", {
        name: "Summarize the key patterns in orders.",
      }),
    );

    expect(onSubmit).toHaveBeenCalledWith(
      "Summarize the key patterns in orders.",
    );
  });
});
