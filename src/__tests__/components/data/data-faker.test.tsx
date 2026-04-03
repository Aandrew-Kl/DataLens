import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataFaker from "@/components/data/data-faker";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

describe("DataFaker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("walks through the wizard and renders preview rows for the selected template", async () => {
    const user = userEvent.setup();

    render(<DataFaker onDataGenerated={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /user analytics/i }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Preview rows")).toBeInTheDocument();
    expect(screen.getByText(/user_id/i)).toBeInTheDocument();
    expect(screen.getByText(/traffic_source/i)).toBeInTheDocument();
    expect(screen.queryByText(/Refresh the preview/i)).not.toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("generates CSV output, downloads it, and forwards it into DataLens", async () => {
    const user = userEvent.setup();
    const onDataGenerated = jest.fn();

    render(<DataFaker onDataGenerated={onDataGenerated} />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: /generate csv/i }));

    expect(await screen.findByText(/Dataset ready:/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /download csv/i }));
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("order_id"),
      expect.stringMatching(/sales-demo-1000\.csv$/),
      "text/csv;charset=utf-8;",
    );

    await user.click(screen.getByRole("button", { name: /load into datalens/i }));
    expect(onDataGenerated).toHaveBeenCalledWith(
      expect.stringContaining("order_id"),
      expect.stringMatching(/sales-demo-1000\.csv$/),
    );
  });

  it("lets the user add and remove custom columns", async () => {
    const user = userEvent.setup();

    render(<DataFaker onDataGenerated={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /custom$/i }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: /add column/i }));

    const columnInputs = screen.getAllByPlaceholderText("column_name");
    await user.type(columnInputs[2]!, "status");

    const row = columnInputs[2]!.closest("div");
    expect(within(row ?? document.body).getByDisplayValue("status")).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button");
    await user.click(removeButtons.find((button) => button.querySelector("svg")) ?? removeButtons[0]!);

    expect(screen.queryByDisplayValue("status")).not.toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
