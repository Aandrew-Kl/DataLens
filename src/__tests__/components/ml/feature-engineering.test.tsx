import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FeatureEngineering from "@/components/ml/feature-engineering";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 12],
  },
  {
    name: "cost",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [5, 6],
  },
  {
    name: "orders",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [2, 3],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<FeatureEngineering tableName="orders" columns={columns} />);
  });
}

describe("FeatureEngineering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the feature engineering workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Create derived features from numeric columns",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("log_revenue").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("previews an interaction feature from selected numeric columns", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { primary_value: 10, secondary_value: 5 },
      { primary_value: 6, secondary_value: 3 },
    ]);

    await renderAsync();
    await user.selectOptions(screen.getByRole("combobox", { name: "Transformation" }), "interaction");
    await user.selectOptions(screen.getByRole("combobox", { name: "Secondary column" }), "cost");
    await user.click(screen.getByRole("button", { name: "Preview features" }));

    // Use findBy* everywhere after the state-triggering click so we wait on
    // the React 19 transition flush instead of racing the render.
    expect(
      await screen.findByText("Previewed 2 rows for revenue_x_cost."),
    ).toBeInTheDocument();
    expect(await screen.findByText("50.0000")).toBeInTheDocument();
    expect(await screen.findByText("18.0000")).toBeInTheDocument();
  });

  it("applies the selected feature and exports the preview CSV", async () => {
    const user = userEvent.setup();

    // Use call-count driven mockImplementation rather than
    // mockResolvedValueOnce -> mockResolvedValue chains. The chain can get
    // drained before React 19's concurrent render settles (same failure
    // mode fixed in Wave 4B for data-cleaner bulk tests). The first
    // runQuery call is the preview (must return the preview row); every
    // subsequent call (ALTER + UPDATE during apply) returns [].
    let queryCallCount = 0;
    mockRunQuery.mockImplementation(async () => {
      queryCallCount += 1;
      if (queryCallCount === 1) {
        return [{ primary_value: 10, secondary_value: null }];
      }
      return [];
    });

    await renderAsync();
    await user.click(
      await screen.findByRole("button", { name: "Preview features" }),
    );
    // Wait for the preview status to commit before triggering apply.
    await screen.findByText("Previewed 1 rows for log_revenue.");

    await user.click(
      await screen.findByRole("button", { name: "Apply feature" }),
    );

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "log_revenue" DOUBLE'),
      );
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "orders" SET "log_revenue" = CASE WHEN TRY_CAST("revenue" AS DOUBLE) > -1'),
      );
    });

    // Export CSV is gated by `previewRows.length === 0` in the component.
    // `previewRows` is committed via `startTransition` in `handlePreview`,
    // and user-event v14 silently swallows clicks on disabled buttons, so
    // racing a plain `findByRole` click will appear to succeed but produce
    // zero downloadFile calls under CI scheduling. Wait for the button to
    // actually be enabled before clicking.
    const exportButton = await screen.findByRole("button", {
      name: "Export CSV",
    });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await user.click(exportButton);

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("row_number,primary_value,secondary_value,log_revenue"),
        "orders-log_revenue-preview.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
