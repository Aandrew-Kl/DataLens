import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PictorialBar from "@/components/charts/pictorial-bar";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

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

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      chartPropsSpy(props);
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: () => "data:image/png;base64,Zm9v",
        }),
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ PictorialBarChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["North", "South"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [100, 80],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<PictorialBar tableName="orders" columns={columns} />);
  });
}

describe("PictorialBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the pictorial bar workspace and controls", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Encode magnitude with repeated symbols instead of solid bars",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Symbol shape")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("renders a pictorial bar option with the chosen symbol shape", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category_label: "North", metric_value: 100 },
      { category_label: "South", metric_value: 80 },
    ]);

    await renderAsync();
    fireEvent.change(screen.getByLabelText("Symbol shape"), {
      target: { value: "triangle" },
    });
    await user.click(screen.getByRole("button", { name: "Render chart" }));

    expect(await screen.findByText(/Rendered 2 categories with triangle symbols/i)).toBeInTheDocument();

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ symbol?: string }>;
    };
    expect(option.series?.[0]?.symbol).toBe("triangle");
  });

  it("exports the pictorial bar chart as PNG", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category_label: "North", metric_value: 100 },
      { category_label: "South", metric_value: 80 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Render chart" }));
    await screen.findByText(/Rendered 2 categories/i);

    await user.click(screen.getByRole("button", { name: "Export PNG" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "orders-pictorial-bar.png",
      "image/png",
    );
  });
});
