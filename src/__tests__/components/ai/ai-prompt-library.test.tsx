import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AIPromptLibrary from "@/components/ai/ai-prompt-library";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["North", "South"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AIPromptLibrary tableName="orders" columns={columns} />);
  });
}

describe("AIPromptLibrary", () => {
  const writeText = jest.fn<Promise<void>, [string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    writeText.mockResolvedValue(undefined);
  });

  it("loads saved prompts and filters them by search and category", async () => {
    window.localStorage.setItem(
      "datalens:ai-prompt-library",
      JSON.stringify([
        {
          id: "prompt-1",
          title: "Monthly reporting",
          category: "reporting",
          prompt: "Summarize the month.",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "prompt-2",
          title: "Data cleanup",
          category: "cleaning",
          prompt: "Find nulls and duplicates.",
          createdAt: 1,
          updatedAt: 3,
        },
      ]),
    );

    const user = userEvent.setup();

    await renderAsync();
    await user.type(screen.getByPlaceholderText(/Search prompts/i), "monthly");
    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "reporting");

    expect(screen.getByText("Monthly reporting")).toBeInTheDocument();
    expect(screen.queryByText("Data cleanup")).not.toBeInTheDocument();
  });

  it("saves a new prompt and persists it to localStorage", async () => {
    const user = userEvent.setup();

    await renderAsync();

    fireEvent.change(screen.getByPlaceholderText("Prompt name"), {
      target: { value: "Trend exploration" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        /Describe the exact analysis task you want the assistant to perform/i,
      ),
      {
        target: { value: "Explain the strongest trend in revenue by region." },
      },
    );
    await user.click(screen.getByRole("button", { name: /Save prompt/i }));

    expect(await screen.findByText("Prompt saved.")).toBeInTheDocument();
    expect(window.localStorage.getItem("datalens:ai-prompt-library")).toEqual(
      expect.stringContaining("Trend exploration"),
    );
  });

  it("edits, copies, and deletes a prompt", async () => {
    window.localStorage.setItem(
      "datalens:ai-prompt-library",
      JSON.stringify([
        {
          id: "prompt-3",
          title: "Exploration pass",
          category: "exploration",
          prompt: "Review the first anomalies.",
          createdAt: 1,
          updatedAt: 2,
        },
      ]),
    );

    const user = userEvent.setup();

    await renderAsync();

    await user.click(screen.getByRole("button", { name: /Edit/i }));
    fireEvent.change(screen.getByPlaceholderText("Prompt name"), {
      target: { value: "Exploration pass v2" },
    });
    await user.click(screen.getByRole("button", { name: /Update prompt/i }));

    expect(await screen.findByText("Prompt updated.")).toBeInTheDocument();
    expect(window.localStorage.getItem("datalens:ai-prompt-library")).toEqual(
      expect.stringContaining("Exploration pass v2"),
    );

    await user.click(screen.getByRole("button", { name: /^Copy$/i }));
    expect(
      await screen.findByText(/Copied "Exploration pass v2" to the clipboard/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Delete$/i }));
    expect(window.localStorage.getItem("datalens:ai-prompt-library")).toBe("[]");
  });
});
