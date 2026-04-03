import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReportScheduler from "@/components/report/report-scheduler";

async function renderAsync() {
  await act(async () => {
    render(<ReportScheduler />);
  });
}

describe("ReportScheduler", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the empty schedule state with default form values", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Keep recurring reports on a predictable cadence",
      }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Weekly executive summary")).toBeInTheDocument();
    expect(
      screen.getByText(/No report schedules saved yet\. Create a cadence above/i),
    ).toBeInTheDocument();
  });

  it("adds a weekly schedule with the default cadence details", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Add schedule" }));

    expect(await screen.findByText("Weekly executive summary")).toBeInTheDocument();
    expect(
      screen.getByText("Executive Summary · Weekly on Monday at 09:00"),
    ).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("datalens-report-scheduler") ?? "[]"),
    ).toHaveLength(1);
  });

  it("switches to monthly scheduling controls and saves the chosen cadence", async () => {
    const user = userEvent.setup();

    await renderAsync();

    fireEvent.change(screen.getByRole("textbox", { name: "Report name" }), {
      target: { value: "Revenue pulse" },
    });
    await user.selectOptions(screen.getByRole("combobox", { name: "Frequency" }), "monthly");
    await user.selectOptions(screen.getByRole("combobox", { name: "Day of month" }), "12");
    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "10:30" },
    });
    await user.click(screen.getByRole("button", { name: "Add schedule" }));

    expect(screen.queryByText("Daily cadence")).not.toBeInTheDocument();
    expect(await screen.findByText("Revenue pulse")).toBeInTheDocument();
    expect(
      screen.getByText("Executive Summary · Monthly on day 12 at 10:30"),
    ).toBeInTheDocument();
  });

  it("toggles and deletes a saved schedule", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens-report-scheduler",
      JSON.stringify([
        {
          id: "schedule-1",
          reportName: "Trend watch",
          templateId: "trend-analysis",
          frequency: "weekly",
          dayOfWeek: 2,
          dayOfMonth: 1,
          time: "08:15",
          enabled: true,
          createdAt: Date.UTC(2026, 3, 1),
        },
      ]),
    );

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("Paused")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("Trend watch")).not.toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("datalens-report-scheduler") ?? "[]"),
    ).toHaveLength(0);
  });
});
