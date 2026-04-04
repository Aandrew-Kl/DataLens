import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AbTestAnalyzer from "@/components/analytics/ab-test-analyzer";
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
    name: "experiment_group",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["control", "treatment"],
  },
  {
    name: "conversion_rate",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 12],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AbTestAnalyzer tableName="experiments" columns={columns} />);
  });
}

describe("AbTestAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the A/B analysis workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Compare control and treatment performance",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose a test split and a metric to estimate lift and significance."),
    ).toBeInTheDocument();
  });

  it("computes lift and significance across control and treatment groups", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { experiment_group: "control", metric_value: 10 },
      { experiment_group: "control", metric_value: 11 },
      { experiment_group: "control", metric_value: 12 },
      { experiment_group: "treatment", metric_value: 13 },
      { experiment_group: "treatment", metric_value: 14 },
      { experiment_group: "treatment", metric_value: 15 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Backend: on" }));
    await user.click(screen.getByRole("button", { name: "Analyze test" }));

    expect(
      await screen.findByText(/Treatment improves conversion_rate by 27\.3% with p=/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("control").length).toBeGreaterThan(0);
    expect(screen.getAllByText("treatment").length).toBeGreaterThan(0);
  });

  it("exports the A/B result as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { experiment_group: "control", metric_value: 10 },
      { experiment_group: "control", metric_value: 11 },
      { experiment_group: "control", metric_value: 12 },
      { experiment_group: "treatment", metric_value: 13 },
      { experiment_group: "treatment", metric_value: 14 },
      { experiment_group: "treatment", metric_value: 15 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Backend: on" }));
    await user.click(screen.getByRole("button", { name: "Analyze test" }));
    await screen.findByText(/Treatment improves conversion_rate by 27\.3% with p=/);
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("control_group,treatment_group,control_mean,treatment_mean,lift"),
      "experiments-ab-test-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
