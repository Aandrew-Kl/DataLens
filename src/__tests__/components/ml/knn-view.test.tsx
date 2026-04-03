import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import KnnView from "@/components/ml/knn-view";
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

const classificationRows = [
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
    render(<KnnView tableName="orders" columns={columns} />);
  });
}

describe("KnnView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the KNN controls and empty results", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Classify holdout rows with local nearest-neighbor voting",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Distance metric")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("runs KNN with manhattan distance and exports the predictions", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(classificationRows);

    await renderAsync();
    fireEvent.change(screen.getByLabelText("Distance metric"), {
      target: { value: "manhattan" },
    });
    await user.click(screen.getByRole("button", { name: "Run analysis" }));

    expect(await screen.findByText(/Evaluated 6 holdout predictions/i)).toBeInTheDocument();
    expect(screen.getAllByText("Enterprise").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("actual,predicted,correct"),
      "orders-knn-results.csv",
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
