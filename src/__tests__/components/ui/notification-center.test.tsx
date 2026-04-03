import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NotificationCenter, {
  type Notification,
} from "@/components/ui/notification-center";

function makeNotification(
  id: string,
  title: string,
  type: Notification["type"] = "info",
): Notification {
  return {
    id,
    title,
    message: `${title} message`,
    type,
  };
}

describe("NotificationCenter", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing when there are no notifications", () => {
    render(
      <NotificationCenter notifications={[]} removeNotification={jest.fn()} />,
    );

    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows only the latest five notifications and exposes clear all", async () => {
    const user = userEvent.setup();
    const clearAll = jest.fn();

    render(
      <NotificationCenter
        notifications={[
          makeNotification("1", "First"),
          makeNotification("2", "Second"),
          makeNotification("3", "Third"),
          makeNotification("4", "Fourth"),
          makeNotification("5", "Fifth"),
          makeNotification("6", "Sixth"),
        ]}
        removeNotification={jest.fn()}
        clearAll={clearAll}
      />,
    );

    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Sixth")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    await waitFor(() => {
      expect(clearAll).toHaveBeenCalledTimes(1);
    });
  });

  it("runs actions and dismisses the acted-on notification", async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    const removeNotification = jest.fn();

    render(
      <NotificationCenter
        notifications={[
          {
            id: "1",
            title: "Query failed",
            message: "Retry the query",
            type: "error",
            action: { label: "Retry", onClick: onRetry },
          },
        ]}
        removeNotification={removeNotification}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(removeNotification).toHaveBeenCalledWith("1");
    });
  });

  it("uses alert and status roles and supports dismiss buttons", async () => {
    const user = userEvent.setup();
    const removeNotification = jest.fn();

    render(
      <NotificationCenter
        notifications={[
          makeNotification("1", "Saved", "success"),
          makeNotification("2", "Broken", "error"),
        ]}
        removeNotification={removeNotification}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("alert")).toHaveTextContent("Broken");

    await user.click(screen.getByRole("button", { name: "Dismiss Saved" }));

    await waitFor(() => {
      expect(removeNotification).toHaveBeenCalledWith("1");
    });
  });

  it("auto-dismisses notifications after five seconds", async () => {
    jest.useFakeTimers();

    const removeNotification = jest.fn();

    render(
      <NotificationCenter
        notifications={[makeNotification("1", "Expiring", "warning")]}
        removeNotification={removeNotification}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(removeNotification).toHaveBeenCalledWith("1");
    });
  });
});
