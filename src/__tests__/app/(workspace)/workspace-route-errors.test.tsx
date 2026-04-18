import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DashboardError from "@/app/(workspace)/dashboard/error";
import DataOpsError from "@/app/(workspace)/data-ops/error";
import ExploreError from "@/app/(workspace)/explore/error";
import PivotError from "@/app/(workspace)/pivot/error";
import ProfileError from "@/app/(workspace)/profile/error";
import ReportsError from "@/app/(workspace)/reports/error";
import SettingsError from "@/app/(workspace)/settings/error";
import SqlError from "@/app/(workspace)/sql/error";
import TransformsError from "@/app/(workspace)/transforms/error";
import { reportError } from "@/lib/errors/report";

jest.mock("@/lib/errors/report", () => ({
  reportError: jest.fn(),
}));

function ThrowError({
  message = "Workspace route crashed",
}: {
  message?: string;
}): React.ReactNode {
  throw new Error(message);
}

type RouteErrorComponent = React.ComponentType<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

type BoundaryHarnessProps = {
  component: RouteErrorComponent;
  onReset?: () => void;
};

type BoundaryHarnessState = {
  error: (Error & { digest?: string }) | null;
};

class BoundaryHarness extends React.Component<
  BoundaryHarnessProps,
  BoundaryHarnessState
> {
  state: BoundaryHarnessState = {
    error: null,
  };

  static getDerivedStateFromError(
    error: Error & { digest?: string },
  ): BoundaryHarnessState {
    return { error };
  }

  componentDidCatch() {}

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const Component = this.props.component;

      return <Component error={this.state.error} reset={this.handleReset} />;
    }

    return <ThrowError />;
  }
}

const routeCases: Array<{
  component: RouteErrorComponent;
  name: string;
  scope: string;
}> = [
  { component: DashboardError, name: "dashboard", scope: "dashboard-route" },
  { component: DataOpsError, name: "data-ops", scope: "data-ops-route" },
  { component: ExploreError, name: "explore", scope: "explore-route" },
  { component: PivotError, name: "pivot", scope: "pivot-route" },
  { component: ProfileError, name: "profile", scope: "profile-route" },
  { component: ReportsError, name: "reports", scope: "reports-route" },
  { component: SettingsError, name: "settings", scope: "settings-route" },
  { component: SqlError, name: "sql", scope: "sql-route" },
  { component: TransformsError, name: "transforms", scope: "transforms-route" },
];

describe("workspace route error boundaries", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(reportError).mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each(routeCases)(
    "renders fallback, reports the error, and resets for $name",
    async ({ component, scope }) => {
      const user = userEvent.setup();
      const onReset = jest.fn();

      render(<BoundaryHarness component={component} onReset={onReset} />);

      expect(
        await screen.findByText("This section failed to render"),
      ).toBeInTheDocument();
      expect(screen.getByText("Workspace route crashed")).toBeInTheDocument();

      await waitFor(() => {
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Workspace route crashed" }),
          expect.objectContaining({ scope }),
        );
      });

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(onReset).toHaveBeenCalledTimes(1);
    },
  );
});
