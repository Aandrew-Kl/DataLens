import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import JoinBuilder from "@/components/data/join-builder";
import { runQuery } from "@/lib/duckdb/client";
import type { DatasetMeta } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const datasets: DatasetMeta[] = [
  {
    id: "orders",
    name: "orders",
    fileName: "orders.csv",
    rowCount: 120,
    columnCount: 2,
    uploadedAt: 1712102400000,
    sizeBytes: 1024,
    columns: [
      {
        name: "customer_id",
        type: "number",
        nullCount: 0,
        uniqueCount: 100,
        sampleValues: [1, 2, 3],
      },
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 4,
        sampleValues: ["West", "East"],
      },
    ],
  },
  {
    id: "customers",
    name: "customers",
    fileName: "customers.csv",
    rowCount: 100,
    columnCount: 2,
    uploadedAt: 1712102400000,
    sizeBytes: 2048,
    columns: [
      {
        name: "customer_id",
        type: "number",
        nullCount: 0,
        uniqueCount: 100,
        sampleValues: [1, 2, 3],
      },
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["Enterprise", "SMB"],
      },
    ],
  },
];

async function advanceToPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Continue$/i }));
  await user.click(screen.getByRole("button", { name: /Left Join/i }));
  await user.click(screen.getByRole("button", { name: /^Continue$/i }));
  await user.click(screen.getByRole("button", { name: /^Continue$/i }));
}

describe("JoinBuilder", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("shows a warning when fewer than two datasets are available", () => {
    render(
      <JoinBuilder
        datasets={[datasets[0]]}
        onJoinComplete={jest.fn()}
      />,
    );

    expect(
      screen.getByText("At least two datasets are required."),
    ).toBeInTheDocument();
  });

  it("previews a generated join and saves a sanitized view name", async () => {
    const user = userEvent.setup();
    const onJoinComplete = jest.fn();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("LIMIT 25;")) {
        return [
          {
            customer_id: 1,
            region: "West",
            customers__customer_id: 1,
            segment: "Enterprise",
          },
        ];
      }

      if (sql.startsWith('CREATE OR REPLACE VIEW "revenue_view_2025"')) {
        return [];
      }

      return [];
    });

    render(<JoinBuilder datasets={datasets} onJoinComplete={onJoinComplete} />);

    await advanceToPreview(user);

    expect(
      screen.getByText("Preview join SQL and sample rows"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Enterprise")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Continue$/i }));
    fireEvent.change(screen.getByPlaceholderText("joined_view"), {
      target: { value: "Revenue View 2025" },
    });
    await user.click(screen.getByRole("button", { name: /Save as view/i }));

    await waitFor(() => {
      expect(onJoinComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          tableName: "revenue_view_2025",
          sql: expect.stringContaining(
            'CREATE OR REPLACE VIEW "revenue_view_2025" AS',
          ),
        }),
      );
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('CREATE OR REPLACE VIEW "revenue_view_2025" AS'),
    );
  });

  it("surfaces preview failures", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Preview query failed"));

    render(<JoinBuilder datasets={datasets} onJoinComplete={jest.fn()} />);

    await advanceToPreview(user);

    expect(await screen.findByText("Preview failed")).toBeInTheDocument();
    expect(screen.getByText("Preview query failed")).toBeInTheDocument();
  });
});
