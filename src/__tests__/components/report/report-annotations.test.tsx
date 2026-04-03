import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReportAnnotations from "@/components/report/report-annotations";
import type { ColumnProfile } from "@/types/dataset";

const columns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Hardware", "Software"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
];

const storageKey = "datalens-report-annotations:orders";

async function renderAsync() {
  await act(async () => {
    render(<ReportAnnotations tableName="orders" columns={columns} />);
  });
}

describe("ReportAnnotations", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the empty annotations state", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Report annotations",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No annotations stored yet. Add a section note to start building the report narrative.",
      ),
    ).toBeInTheDocument();
  });

  it("adds a new annotation and persists it to localStorage", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.type(screen.getByRole("textbox", { name: "Annotation note" }), "Add a revenue callout.");
    await user.click(screen.getByRole("button", { name: "Add annotation" }));

    expect(screen.getByText("Add a revenue callout.")).toBeInTheDocument();
    expect(window.localStorage.getItem(storageKey)).toContain("Add a revenue callout.");
  });

  it("edits an existing annotation", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "note-1",
          sectionId: "overview",
          sectionLabel: "orders overview",
          content: "Initial note",
          createdAt: Date.UTC(2026, 3, 1),
          updatedAt: Date.UTC(2026, 3, 1),
        },
      ]),
    );

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Annotation note" }));
    await user.type(screen.getByRole("textbox", { name: "Annotation note" }), "Updated note");
    await user.click(screen.getByRole("button", { name: "Save annotation" }));

    expect(screen.getByText("Updated note")).toBeInTheDocument();
    expect(window.localStorage.getItem(storageKey)).toContain("Updated note");
  });

  it("deletes an existing annotation", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "note-1",
          sectionId: "overview",
          sectionLabel: "orders overview",
          content: "Delete me",
          createdAt: Date.UTC(2026, 3, 1),
          updatedAt: Date.UTC(2026, 3, 1),
        },
      ]),
    );

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("Delete me")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(storageKey)).toBe("[]");
  });
});
