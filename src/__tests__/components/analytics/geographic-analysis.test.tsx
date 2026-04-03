import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GeographicAnalysis from "@/components/analytics/geographic-analysis";
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
    name: "latitude",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [37.77, -33.86],
  },
  {
    name: "longitude",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [-122.41, 151.21],
  },
  {
    name: "country",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["US", "AU"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<GeographicAnalysis tableName="locations" columns={columns} />);
  });
}

describe("GeographicAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("auto-detects coordinate columns and renders the workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Summarize spatial coverage by coordinate zones and available regions",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Latitude column")).toHaveValue("latitude");
    expect(screen.getByLabelText("Longitude column")).toHaveValue("longitude");
  });

  it("groups coordinates into geographic zones and region distributions", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { latitude: 37.77, longitude: -122.41, country_name: "US", state_name: null },
      { latitude: -33.86, longitude: 151.21, country_name: "AU", state_name: null },
      { latitude: 51.5, longitude: -0.12, country_name: "UK", state_name: null },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze geography" }));

    expect(await screen.findByText(/Grouped 3 coordinates into 2 geographic zones/i)).toBeInTheDocument();
    expect(screen.getByText("Northern / Western")).toBeInTheDocument();
    expect(screen.getByText("Southern / Eastern")).toBeInTheDocument();
  });

  it("exports the geographic summary as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { latitude: 37.77, longitude: -122.41, country_name: "US", state_name: null },
      { latitude: -33.86, longitude: 151.21, country_name: "AU", state_name: null },
      { latitude: 51.5, longitude: -0.12, country_name: "UK", state_name: null },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze geography" }));
    await screen.findByText(/Grouped 3 coordinates into 2 geographic zones/i);

    await user.click(screen.getByRole("button", { name: "Export analysis CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("zone,count,avg_lat,avg_lon"),
      "locations-geographic-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
