import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReportTemplates from "@/components/report/report-templates";

async function renderAsync() {
  await act(async () => {
    render(<ReportTemplates />);
  });
}

describe("ReportTemplates", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the default selected template when nothing is persisted", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Start from a structure that matches the story you need to tell",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Executive Summary").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Selected" })).toBeInTheDocument();
  });

  it("loads the previously selected template from localStorage", async () => {
    window.localStorage.setItem(
      "datalens-report-template-selection",
      "trend-analysis",
    );

    await renderAsync();

    expect(screen.getAllByText("Trend Analysis").length).toBeGreaterThan(0);
    expect(screen.getByText(/performance pacing, and ongoing trend monitoring/i)).toBeInTheDocument();
  });

  it("applies a new template and persists the active selection", async () => {
    const user = userEvent.setup();

    await renderAsync();
    const card = screen.getByText("Data Quality Report").closest("article");
    expect(card).not.toBeNull();
    await user.click(
      within(card as HTMLElement).getByRole("button", { name: "Apply template" }),
    );

    expect(
      await screen.findByText(/Data Quality Report is now the active report template\./i),
    ).toBeInTheDocument();
    expect(
      window.localStorage.getItem("datalens-report-template-selection"),
    ).toBe("data-quality-report");
  });
});
