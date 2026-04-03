import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccessibilitySettings from "@/components/settings/accessibility-settings";
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
    render(<AccessibilitySettings tableName="orders" columns={columns} />);
  });
}

describe("AccessibilitySettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the accessibility form with dataset context", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Configure accessibility preferences",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /High contrast mode.*Off/i }),
    ).toBeInTheDocument();
  });

  it("persists toggle updates into localStorage", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(
      screen.getByRole("button", { name: /High contrast mode.*Off/i }),
    );

    expect(
      JSON.parse(
        window.localStorage.getItem("datalens:accessibility:orders") ?? "{}",
      ),
    ).toMatchObject({
      highContrast: true,
    });
  });

  it("updates font scale when a scale option is clicked", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Large (1.15x)" }));

    expect(
      JSON.parse(
        window.localStorage.getItem("datalens:accessibility:orders") ?? "{}",
      ),
    ).toMatchObject({
      fontScale: 1.15,
    });
  });
});
