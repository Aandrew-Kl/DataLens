import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShortcutSettings from "@/components/settings/shortcut-settings";
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
    render(<ShortcutSettings tableName="orders" columns={columns} />);
  });
}

describe("ShortcutSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the shortcut list with default bindings", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Customize keyboard shortcuts",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Run query")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ctrl+Enter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ctrl+S" })).toBeInTheDocument();
  });

  it("edits a shortcut and persists to localStorage", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Ctrl+Enter" }));

    // NOTE: under React 19, the edit input is focused via useEffect (not
    // autoFocus) which lands after the click. findByRole awaits the
    // conditional render; fireEvent.change sidesteps user.type's focus
    // requirement and the StrictMode double-mount re-focus race.
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Ctrl+Shift+Enter" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem("datalens:shortcuts:orders") ?? "{}",
        ),
      ).toMatchObject({
        "run-query": "Ctrl+Shift+Enter",
      });
    });
  });

  it("detects conflicts when assigning a duplicate binding", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Ctrl+Enter" }));

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Ctrl+S" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText(/Conflicts with/i)).toBeInTheDocument();
    });
  });
});
