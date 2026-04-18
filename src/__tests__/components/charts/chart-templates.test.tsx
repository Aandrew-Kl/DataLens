import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ChartTemplates from "@/components/charts/chart-templates";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("echarts-for-react", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      return React.createElement("div", {
        ref,
        "data-testid": "echart",
        "data-option": JSON.stringify(props.option ?? null),
      });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "order_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: ["2026-01-01", "2026-02-01"],
    min: "2026-01-01",
    max: "2026-12-01",
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [100, 140],
    min: 10,
    max: 400,
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 90,
    sampleValues: [20, 30],
    min: 5,
    max: 120,
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "country",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["US", "UK"],
  },
];

describe("ChartTemplates", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([{ label: "2026-01", value: 120 }]);
  });

  it("renders the gallery and reads saved templates from localStorage", () => {
    window.localStorage.setItem(
      "datalens:chart-templates",
      JSON.stringify([
        {
          id: "saved-1",
          name: "Saved revenue",
          kind: "line",
          title: "Saved revenue",
          xAxis: "order_date",
          yAxis: "revenue",
          groupBy: "region",
          sizeAxis: "",
          geoField: "country",
          sourceTemplateId: "revenue-over-time",
          createdAt: 1,
        },
      ]),
    );

    render(<ChartTemplates tableName="sales" columns={columns} />);

    expect(screen.getByText("Chart templates")).toBeInTheDocument();
    const savedTemplatesLabel = screen.getByText("Saved templates");
    expect(savedTemplatesLabel).toBeInTheDocument();
    expect(savedTemplatesLabel.nextElementSibling).toHaveTextContent("1");
  });

  it("applies a template and renders a generated preview with SQL", async () => {
    const user = userEvent.setup();

    render(<ChartTemplates tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Revenue over time/i }));

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Revenue over time")).toBeInTheDocument();
    expect(screen.getByText("Applied Revenue over time with auto-mapped fields.")).toBeInTheDocument();
    expect(screen.getByText(/AVG/i)).toBeInTheDocument();
  });

  it("saves the current template configuration to localStorage", async () => {
    const user = userEvent.setup();

    render(<ChartTemplates tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Revenue over time/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Revenue over time")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue("Revenue over time"), {
      target: { value: "Executive revenue trend" },
    });

    await user.click(screen.getByRole("button", { name: "Save current config" }));

    expect(screen.getByText('Saved "Executive revenue trend" to localStorage.')).toBeInTheDocument();
    expect(window.localStorage.getItem("datalens:chart-templates")).toContain(
      "Executive revenue trend",
    );
    expect(
      screen.getByRole("button", { name: /Executive revenue trend/i }),
    ).toBeInTheDocument();
  });

  it("shows the map placeholder without running a DuckDB query", async () => {
    const user = userEvent.setup();

    render(<ChartTemplates tableName="sales" columns={columns} />);
    mockRunQuery.mockClear();

    await user.click(screen.getByRole("button", { name: /Geographic distribution/i }));

    expect(
      await screen.findByText(/Map placeholder is ready for region/i),
    ).toBeInTheDocument();

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("shows a compatibility note when required builder fields are cleared", async () => {
    const user = userEvent.setup();

    render(<ChartTemplates tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Revenue over time/i }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Y axis" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Y axis" }), {
      target: { value: "" },
    });

    expect(
      await screen.findByText(
        "This template needs more compatible columns. Adjust the builder fields to continue.",
      ),
    ).toBeInTheDocument();
  });

  it("shows preview query failures from DuckDB", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockRejectedValue(new Error("Preview query failed"));

    render(<ChartTemplates tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Bubble chart/i }));

    expect(await screen.findByText("Preview query failed")).toBeInTheDocument();
  });

  it("reopens a saved template into the active draft editor", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:chart-templates",
      JSON.stringify([
        {
          id: "saved-2",
          name: "Bubble revisit",
          kind: "bubble",
          title: "Bubble revisit",
          xAxis: "revenue",
          yAxis: "profit",
          groupBy: "region",
          sizeAxis: "revenue",
          geoField: "country",
          sourceTemplateId: "bubble-chart",
          createdAt: 2,
        },
      ]),
    );

    render(<ChartTemplates tableName="sales" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Bubble revisit/i }));

    expect(await screen.findByDisplayValue("Bubble revisit")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Bubble size" }),
    ).toHaveValue("revenue");
  });
});
