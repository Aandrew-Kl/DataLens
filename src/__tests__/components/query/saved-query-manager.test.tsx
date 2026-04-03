import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SavedQueryManager from "@/components/query/saved-query-manager";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockDownloadFile = jest.mocked(downloadFile);
const STORAGE_KEY = "datalens-saved-query-manager";
const clipboardWriteText = jest.fn<Promise<void>, [string]>();

const columns: ColumnProfile[] = [
  {
    name: "month",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["2026-01-01", "2026-02-01"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<SavedQueryManager tableName="sales" columns={columns} />);
  });
}

describe("SavedQueryManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  it("saves foldered queries with tags and notes", async () => {
    const user = userEvent.setup();

    await renderAsync();

    fireEvent.change(screen.getByPlaceholderText("Weekly revenue summary"), {
      target: { value: "Weekly revenue summary" },
    });
    fireEvent.change(screen.getByPlaceholderText("Finance"), {
      target: { value: "Finance" },
    });
    fireEvent.change(screen.getByPlaceholderText("finance, monthly, exec"), {
      target: { value: "finance, executive" },
    });
    fireEvent.change(
      screen.getByPlaceholderText('SELECT month, SUM(revenue) FROM "sales" GROUP BY month;'),
      { target: { value: 'SELECT month, SUM(revenue) FROM "sales" GROUP BY month;' } },
    );
    fireEvent.change(screen.getByPlaceholderText("Notes, caveats, or business context."), {
      target: { value: "Used in the weekly business review." },
    });

    await user.click(screen.getByRole("button", { name: "Save query" }));

    expect(await screen.findByText("Saved query collection updated.")).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as Array<{
      folder: string;
      tags: string[];
      notes: string;
    }>;
    expect(stored[0]?.folder).toBe("Finance");
    expect(stored[0]?.tags).toEqual(["finance", "executive"]);
    expect(stored[0]?.notes).toBe("Used in the weekly business review.");
  });

  it("exports and imports saved query collections", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "query-1",
          name: "Revenue summary",
          folder: "Finance",
          tags: ["finance"],
          sql: 'SELECT SUM(revenue) FROM "sales";',
          notes: "",
          starred: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]),
    );

    let renderedResult: ReturnType<typeof render> | undefined;
    await act(async () => {
      renderedResult = render(<SavedQueryManager tableName="sales" columns={columns} />);
    });

    await user.click(screen.getByRole("button", { name: "Export collection" }));
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Revenue summary"),
      "sales-saved-query-collection.json",
      "application/json;charset=utf-8;",
    );

    const fileInput = renderedResult?.container.querySelector('input[type="file"]') as HTMLInputElement;
    const importFile = new File(
      [
        JSON.stringify([
          {
            id: "query-2",
            name: "Imported query",
            folder: "Ops",
            tags: ["ops"],
            sql: 'SELECT COUNT(*) FROM "sales";',
            notes: "",
            starred: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]),
      ],
      "queries.json",
      { type: "application/json" },
    );
    Object.defineProperty(importFile, "text", {
      configurable: true,
      value: jest.fn().mockResolvedValue(
        JSON.stringify([
          {
            id: "query-2",
            name: "Imported query",
            folder: "Ops",
            tags: ["ops"],
            sql: 'SELECT COUNT(*) FROM "sales";',
            notes: "",
            starred: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]),
      ),
    });

    fireEvent.change(fileInput, { target: { files: [importFile] } });
    expect(await screen.findByText("Imported saved query collection.")).toBeInTheDocument();
    expect(screen.getByText("Imported query")).toBeInTheDocument();
  });

  it("copies a share URL for saved queries", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "query-1",
          name: "Revenue summary",
          folder: "Finance",
          tags: ["finance"],
          sql: 'SELECT SUM(revenue) FROM "sales";',
          notes: "",
          starred: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]),
    );

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Share URL" }));

    expect(await screen.findByText("Copied share URL for Revenue summary.")).toBeInTheDocument();
  });
});
