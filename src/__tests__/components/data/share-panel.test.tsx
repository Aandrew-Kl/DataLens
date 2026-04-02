import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SharePanel from "@/components/data/share-panel";
import { downloadFile } from "@/lib/utils/export";
import type { DatasetMeta } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const dataset: DatasetMeta = {
  id: "sales-1",
  name: "Sales dashboard",
  fileName: "sales.csv",
  rowCount: 1200,
  columnCount: 2,
  uploadedAt: 1712102400000,
  sizeBytes: 2048,
  columns: [
    {
      name: "region",
      type: "string",
      nullCount: 0,
      uniqueCount: 4,
      sampleValues: ["West", "East"],
    },
    {
      name: "amount",
      type: "number",
      nullCount: 0,
      uniqueCount: 100,
      sampleValues: [10, 20],
    },
  ],
};

describe("SharePanel", () => {
  beforeEach(() => {
    mockDownloadFile.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("does not render when the panel is closed", () => {
    render(
      <SharePanel
        open={false}
        onClose={jest.fn()}
        dataset={dataset}
        currentTab="profile"
      />,
    );

    expect(
      screen.queryByRole("dialog", { name: /Share Sales dashboard/i }),
    ).not.toBeInTheDocument();
  });

  it("renders share artifacts, copies content, and exports the config file", async () => {
    const user = userEvent.setup();
    const writeTextSpy = jest
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(
      <SharePanel
        open
        onClose={jest.fn()}
        dataset={dataset}
        currentTab="quality"
        currentSQL='SELECT * FROM "sales"'
      />,
    );

    expect(
      screen.getByRole("dialog", { name: /Share Sales dashboard/i }),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^Copy$/i })[0]);
    expect(writeTextSpy).toHaveBeenCalledWith(
      expect.stringContaining("<iframe"),
    );

    await user.click(screen.getByRole("button", { name: /Export \.datalens/i }));
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining('"format": "datalens"'),
      "sales-dashboard.datalens",
      "application/json;charset=utf-8;",
    );

    writeTextSpy.mockRestore();
  });

  it("calls onClose when escape is pressed", () => {
    const onClose = jest.fn();

    render(
      <SharePanel
        open
        onClose={onClose}
        dataset={dataset}
        currentTab="profile"
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
