import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NaiveBayesView from "@/components/ml/naive-bayes-view";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: (_target, tag) =>
          React.forwardRef(function MockMotion(
            props: Record<string, unknown> & { children?: ReactNode },
            ref: React.Ref<Element>,
          ) {
            return React.createElement(String(tag), { ...props, ref }, props.children);
          }),
      },
    ),
  };
});

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Enterprise", "SMB"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 110],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [25, 28],
  },
];

const trainingRows = [
  ...Array.from({ length: 10 }, (_, index) => ({
    target_label: "Enterprise",
    revenue: 100 + index * 3,
    profit: 30 + index,
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    target_label: "SMB",
    revenue: 300 + index * 3,
    profit: 80 + index,
  })),
];

async function renderAsync() {
  await act(async () => {
    render(<NaiveBayesView tableName="orders" columns={columns} />);
  });
}

describe("NaiveBayesView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the Naive Bayes controls and empty states", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Estimate posterior class probabilities from numeric features",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByText(/Run the model to inspect class priors/i)).toBeInTheDocument();
  });

  it("runs analysis, shows priors, and exports the holdout predictions", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(trainingRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Run analysis" }));

    expect(await screen.findByText(/Scored 6 holdout predictions/i)).toBeInTheDocument();
    expect(screen.getAllByText("Enterprise").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SMB").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("actual,predicted,confidence"),
      "orders-naive-bayes-results.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("shows a validation error when all numeric features are deselected", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "revenue" }));
    await user.click(screen.getByRole("button", { name: "profit" }));
    await user.click(screen.getByRole("button", { name: "Run analysis" }));

    expect(
      screen.getByText("Select one target column and at least one numeric feature."),
    ).toBeInTheDocument();
  });
});
