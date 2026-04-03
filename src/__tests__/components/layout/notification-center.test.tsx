import { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import NotificationCenter from "@/components/layout/notification-center";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

const columns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["active", "paused"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<NotificationCenter tableName="orders" columns={columns} />);
  });
}

function seedNotifications() {
  window.localStorage.setItem(
    "datalens-notification-center",
    JSON.stringify([
      {
        id: "n1",
        title: "Export complete",
        message: "CSV export finished successfully.",
        tone: "success",
        read: false,
        createdAt: Date.now() - 5_000,
      },
      {
        id: "n2",
        title: "Query warning",
        message: "A scheduled query missed its last interval.",
        tone: "warning",
        read: false,
        createdAt: Date.now() - 15_000,
      },
    ]),
  );
}

describe("NotificationCenter", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedNotifications();
  });

  it("shows the unread notification count on the launcher", async () => {
    await renderAsync();

    const launcher = screen.getByRole("button", { name: /open notifications/i });
    expect(within(launcher).getByText("2")).toBeInTheDocument();
  });

  it("marks a notification as read and updates the unread count", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open notifications/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /mark as read/i })[0]);
    });

    expect(await screen.findByText(/1 unread items remain/i)).toBeInTheDocument();
  });

  it("clears all notifications from the panel", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open notifications/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    });

    expect(
      await screen.findByText(/No notifications in the queue/i),
    ).toBeInTheDocument();
  });
});
