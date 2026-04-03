import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationSettings from "@/components/settings/notification-settings";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<NotificationSettings tableName="orders" columns={columns} />);
  });
}

describe("NotificationSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the notification form with dataset context", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Control local alerts for queries and exports",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Query completion alerts.*On/i }),
    ).toBeInTheDocument();
  });

  it("persists toggle updates into localStorage", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(
      screen.getByRole("button", { name: /Query completion alerts.*On/i }),
    );

    expect(
      JSON.parse(
        window.localStorage.getItem("datalens:notifications:orders") ?? "{}",
      ),
    ).toMatchObject({
      queryAlerts: false,
    });
  });

  it("updates the notification position preview", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "bottom-right" }));

    expect(screen.getAllByText(/bottom-right/i).length).toBeGreaterThan(0);
  });
});
