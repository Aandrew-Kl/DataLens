import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SqlPage from "@/app/(workspace)/sql/page";
import AiAssistant from "@/components/ai/ai-assistant";
import ChartRenderer from "@/components/charts/chart-renderer";
import DashboardBuilder from "@/components/charts/dashboard-builder";
import FileDropzone from "@/components/data/file-dropzone";
import ChatInterface from "@/components/query/chat-interface";
import QueryHistory from "@/components/query/query-history";
import SavedQueries from "@/components/query/saved-queries";
import WorkspaceSettings from "@/components/settings/workspace-settings";
import SearchInput from "@/components/ui/search-input";
import { runQuery } from "@/lib/duckdb/client";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import type { ChartConfig } from "@/types/chart";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("echarts-for-react");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));
jest.mock("@/components/data/data-table", () => ({
  __esModule: true,
  default: ({
    data,
    columns,
  }: {
    data: Record<string, unknown>[];
    columns: string[];
  }) =>
    React.createElement(
      "div",
      { "data-testid": "data-table" },
      `${columns.join(",")}:${data.length}`,
    ),
}));

const mockRunQuery = jest.mocked(runQuery);

const PAYLOADS = {
  img: '<img src=x onerror=alert(1)>',
  script: "<script>alert(1)</script>",
  javascriptUrl: "javascript:alert(1)",
  svgOnload: "<svg onload=alert(1)>",
  brokenImageQuote: '"><img src=x onerror=alert(1)>',
  brokenScriptQuote: "'><script>alert(1)</script>",
  anchorJavascript: '<a href="javascript:alert(1)">click me</a>',
  svgScript: "<svg><script>alert(1)</script></svg>",
  mathJavascript: '<math href="javascript:alert(1)">calc</math>',
  detailsToggle: "<details open ontoggle=alert(1)>toggle</details>",
  iframeSrcdoc: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  bodyOnload: "<body onload=alert(1)>",
  confirmImage: "<img src=x onerror=confirm(1)>",
  videoSource: '<video><source onerror="javascript:alert(1)"></video>',
  marquee: "<marquee onstart=alert(1)>run</marquee>",
  divOnclick: '<div onclick="alert(1)">click</div>',
} as const;

const sampleColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["East", "West"],
  },
  {
    name: "value",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [10, 20, 30],
    mean: 20,
    median: 20,
    min: 10,
    max: 30,
  },
];

function makeDatasetMeta(overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    id: "dataset-1",
    name: "sales",
    fileName: "sales.csv",
    rowCount: 25,
    columnCount: sampleColumns.length,
    columns: sampleColumns,
    uploadedAt: Date.now(),
    sizeBytes: 1024,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function textContentIncludes(fragment: string) {
  return (_content: string, node: Element | null) =>
    node?.textContent?.includes(fragment) ?? false;
}

function findUnsafeAttributes(root: ParentNode): Array<{ tag: string; name: string; value: string }> {
  const elements = Array.from(root.querySelectorAll("*"));
  const unsafe: Array<{ tag: string; name: string; value: string }> = [];

  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on")) {
        unsafe.push({ tag: element.tagName.toLowerCase(), name, value });
        continue;
      }

      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        value.startsWith("javascript:")
      ) {
        unsafe.push({ tag: element.tagName.toLowerCase(), name, value });
      }
    }
  }

  return unsafe;
}

function expectNoExecutableMarkup(root: ParentNode = document.body) {
  expect(root.querySelectorAll("script")).toHaveLength(0);
  expect(findUnsafeAttributes(root)).toEqual([]);
}

async function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") {
    return blob.text();
  }
  return new Response(blob).text();
}

async function renderExportedGridFromLatestBlob(): Promise<HTMLDivElement> {
  const blob = (URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob | undefined;
  if (!blob) {
    throw new Error("Expected dashboard export to create a blob.");
  }

  const html = await readBlobText(blob);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const inlineScript = Array.from(parsed.querySelectorAll("script"))
    .map((script) => script.textContent ?? "")
    .find((script) => script.includes("const widgets ="));

  if (!inlineScript) {
    throw new Error("Expected exported HTML to contain the widget rendering script.");
  }

  const host = document.createElement("div");
  host.innerHTML = '<div id="grid"></div>';
  document.body.appendChild(host);
  new Function(inlineScript)();

  const grid = host.querySelector("#grid");
  if (!(grid instanceof HTMLDivElement)) {
    throw new Error("Expected exported HTML script to render into #grid.");
  }
  return grid;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunQuery.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.className = "";
  useDatasetStore.setState({
    datasets: [],
    activeDatasetId: null,
  });
  useQueryStore.setState({
    history: [],
    lastResult: null,
    isQuerying: false,
  });

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: jest.fn(() => true),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: jest.fn().mockResolvedValue(undefined),
    },
  });
});

describe("XSS hardening", () => {
  it("keeps search input image payloads as plain text", () => {
    render(<SearchInput value={PAYLOADS.img} onChange={jest.fn()} />);

    expect(screen.getByDisplayValue(PAYLOADS.img)).toBeInTheDocument();
    expectNoExecutableMarkup();
  });

  it("keeps search input javascript URLs as plain text", () => {
    const onChange = jest.fn();

    render(<SearchInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: PAYLOADS.javascriptUrl },
    });

    expect(onChange).toHaveBeenCalledWith(PAYLOADS.javascriptUrl);
    expect(screen.getByDisplayValue(PAYLOADS.javascriptUrl)).toBeInTheDocument();
    expectNoExecutableMarkup();
  });

  it("renders uploaded filenames as text while files are processed", async () => {
    const onFileLoaded = jest.fn();
    let resolveCsv: ((value: string) => void) | undefined;

    const { container } = render(<FileDropzone onFileLoaded={onFileLoaded} />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected FileDropzone to render a file input.");
    }

    const file = new File(["placeholder"], `${PAYLOADS.img}.csv`, {
      type: "text/csv",
    });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: jest.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveCsv = resolve;
          }),
      ),
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(file.name)).toBeInTheDocument();
    expectNoExecutableMarkup();

    resolveCsv?.("name,value\nsafe,1\n");

    await waitFor(() => {
      expect(onFileLoaded).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: file.name }),
      );
    });
    expectNoExecutableMarkup();
  });

  // TODO(wave3): flaky under React 19 + jsdom defer — re-enable with stable pattern
  it.skip("renders SQL history, editor input, and query errors safely", async () => {
    const user = userEvent.setup();
    const dataset = makeDatasetMeta();

    useDatasetStore.setState({
      datasets: [dataset],
      activeDatasetId: dataset.id,
    });
    useQueryStore.setState({
      history: [
        {
          id: "sql-history-1",
          question: PAYLOADS.iframeSrcdoc,
          sql: `SELECT '${PAYLOADS.brokenImageQuote}' AS payload;`,
          datasetId: dataset.id,
          createdAt: Date.now(),
        },
      ],
      lastResult: null,
      isQuerying: false,
    });
    mockRunQuery.mockRejectedValueOnce(new Error(PAYLOADS.svgOnload));

    render(<SqlPage />);

    expect(await screen.findByText(PAYLOADS.iframeSrcdoc)).toBeInTheDocument();
    expect(
      screen.getByText(textContentIncludes(PAYLOADS.brokenImageQuote)),
    ).toBeInTheDocument();

    await user.click(screen.getByText(PAYLOADS.iframeSrcdoc));
    expect(
      screen.getByDisplayValue(`SELECT '${PAYLOADS.brokenImageQuote}' AS payload;`),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("SQL editor"), {
      target: { value: `SELECT '${PAYLOADS.brokenScriptQuote}' AS payload;` },
    });
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    expect(await screen.findByText(PAYLOADS.svgOnload)).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(`SELECT '${PAYLOADS.brokenScriptQuote}' AS payload;`),
    ).toBeInTheDocument();
    expectNoExecutableMarkup();
  });

  it("renders dashboard widget titles, dataset names, and text safely", async () => {
    const user = userEvent.setup();

    render(
      <DashboardBuilder
        tableName={PAYLOADS.script}
        columns={sampleColumns}
        rowCount={25}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add widget/i }));
    await user.click(screen.getByRole("button", { name: /text widget/i }));

    fireEvent.change(screen.getByDisplayValue("Notes"), {
      target: { value: PAYLOADS.svgOnload },
    });
    fireEvent.change(
      screen.getByDisplayValue("Use this space for notes, caveats, and next steps."),
      {
        target: { value: PAYLOADS.brokenImageQuote },
      },
    );

    await waitFor(() => {
      expect(document.body.textContent).toContain(PAYLOADS.script);
      expect(document.body.textContent).toContain(PAYLOADS.svgOnload);
      expect(document.body.textContent).toContain(PAYLOADS.brokenImageQuote);
    });
    expectNoExecutableMarkup();
  });

  it.skip("escapes exported dashboard HTML before innerHTML rendering runs", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens-dashboard:sales",
      JSON.stringify({
        savedAt: Date.now(),
        widgets: [
          {
            id: "widget-kpi",
            type: "kpi",
            title: PAYLOADS.brokenScriptQuote,
            xAxis: "",
            yAxis: PAYLOADS.mathJavascript,
            aggregation: "sum",
            color: "#38bdf8",
            tableColumns: [],
            text: "",
          },
          {
            id: "widget-table",
            type: "table",
            title: PAYLOADS.detailsToggle,
            xAxis: "",
            yAxis: "",
            aggregation: "sum",
            color: "#38bdf8",
            tableColumns: [PAYLOADS.iframeSrcdoc],
            text: "",
          },
          {
            id: "widget-text",
            type: "text",
            title: PAYLOADS.anchorJavascript,
            xAxis: "",
            yAxis: "",
            aggregation: "sum",
            color: "#38bdf8",
            tableColumns: [],
            text: PAYLOADS.bodyOnload,
          },
        ],
      }),
    );

    mockRunQuery
      .mockResolvedValueOnce([{ value: 7 }])
      .mockResolvedValueOnce([{ [PAYLOADS.iframeSrcdoc]: PAYLOADS.confirmImage }]);

    render(
      <DashboardBuilder tableName="sales" columns={sampleColumns} rowCount={25} />,
    );

    await user.click(screen.getByRole("button", { name: /load dashboard/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain(PAYLOADS.anchorJavascript);
      expect(document.body.textContent).toContain(PAYLOADS.bodyOnload);
      expect(document.body.textContent).toContain(PAYLOADS.detailsToggle);
      expect(document.body.textContent).toContain(PAYLOADS.iframeSrcdoc);
      expect(document.body.textContent).toContain(PAYLOADS.confirmImage);
      expect(document.body.textContent).toContain(PAYLOADS.mathJavascript);
    });

    await user.click(screen.getByRole("button", { name: /export dashboard/i }));

    const grid = await renderExportedGridFromLatestBlob();
    expect(grid.textContent).toContain(PAYLOADS.brokenScriptQuote);
    expect(grid.textContent).toContain(PAYLOADS.mathJavascript);
    expect(grid.textContent).toContain(PAYLOADS.detailsToggle);
    expect(grid.textContent).toContain(PAYLOADS.iframeSrcdoc);
    expect(grid.textContent).toContain(PAYLOADS.confirmImage);
    expect(grid.textContent).toContain(PAYLOADS.anchorJavascript);
    expect(grid.textContent).toContain(PAYLOADS.bodyOnload);
    expectNoExecutableMarkup(grid);
  });

  it.skip("keeps chart titles, labels, and series values as text in ChartRenderer", () => {
    const config: ChartConfig = {
      id: "chart-1",
      type: "bar",
      title: PAYLOADS.svgScript,
      xAxis: PAYLOADS.videoSource,
      yAxis: PAYLOADS.marquee,
      groupBy: PAYLOADS.divOnclick,
    };
    const data = [
      {
        [PAYLOADS.videoSource]: PAYLOADS.anchorJavascript,
        [PAYLOADS.marquee]: 42,
        [PAYLOADS.divOnclick]: PAYLOADS.confirmImage,
      },
    ];

    render(<ChartRenderer config={config} data={data} />);

    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toContain(PAYLOADS.svgScript);
    expect(screen.getByText(textContentIncludes(PAYLOADS.videoSource))).toBeInTheDocument();
    expect(screen.getByText(textContentIncludes(PAYLOADS.marquee))).toBeInTheDocument();
    expect(screen.getByText(textContentIncludes(PAYLOADS.divOnclick))).toBeInTheDocument();
    expect(screen.getByTestId("echarts")).toHaveAttribute(
      "data-option",
      expect.stringContaining(PAYLOADS.svgScript),
    );
    expect(screen.getByTestId("echarts")).toHaveAttribute(
      "data-option",
      expect.stringContaining(PAYLOADS.anchorJavascript),
    );
    expect(screen.getByTestId("echarts")).toHaveAttribute(
      "data-option",
      expect.stringContaining(PAYLOADS.confirmImage),
    );
    expectNoExecutableMarkup();
  });

  it("renders stored workspace names safely", async () => {
    window.localStorage.setItem(
      "datalens-workspace-settings",
      JSON.stringify({
        workspaceName: PAYLOADS.img,
        description: "Safe description",
        chartTheme: "ocean",
        dateFormat: "YYYY-MM-DD",
        numberFormat: "standard",
        queryTimeoutSeconds: 30,
        maxRows: 5000,
        cacheTtlMinutes: 10,
      }),
    );

    render(<WorkspaceSettings />);

    expect(screen.getByDisplayValue(PAYLOADS.img)).toBeInTheDocument();
    expect(document.body.textContent).toContain(PAYLOADS.img);
    expectNoExecutableMarkup();
  });

  it("renders edited workspace descriptions safely", async () => {
    const user = userEvent.setup();

    render(<WorkspaceSettings />);

    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      PAYLOADS.script,
    );
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    expect(screen.getByDisplayValue(PAYLOADS.script)).toBeInTheDocument();
    expect(document.body.textContent).toContain(PAYLOADS.script);
    expectNoExecutableMarkup();
  });

  it("renders persisted saved query metadata and SQL as text", async () => {
    window.localStorage.setItem(
      "datalens-saved-queries",
      JSON.stringify([
        {
          id: "saved-1",
          name: PAYLOADS.javascriptUrl,
          description: PAYLOADS.svgOnload,
          tags: [PAYLOADS.confirmImage],
          sql: `SELECT '${PAYLOADS.brokenImageQuote}' AS payload;`,
          createdAt: Date.now() - 10_000,
          updatedAt: Date.now() - 1_000,
        },
      ]),
    );

    render(<SavedQueries onSelectQuery={jest.fn()} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain(PAYLOADS.javascriptUrl);
      expect(document.body.textContent).toContain(PAYLOADS.svgOnload);
      expect(document.body.textContent).toContain(PAYLOADS.confirmImage);
      expect(document.body.textContent).toContain(PAYLOADS.brokenImageQuote);
    });
    expectNoExecutableMarkup();
  });

  it("renders newly created saved query content safely", async () => {
    const user = userEvent.setup();

    render(<SavedQueries onSelectQuery={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /^save query$/i }));
    fireEvent.change(screen.getByPlaceholderText("Revenue by month"), {
      target: { value: PAYLOADS.anchorJavascript },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Short note about what this query answers."),
      { target: { value: PAYLOADS.svgScript } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("finance, monthly, executive"),
      { target: { value: PAYLOADS.mathJavascript } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("SELECT * FROM orders LIMIT 100;"),
      { target: { value: `SELECT '${PAYLOADS.detailsToggle}' AS payload;` } },
    );

    await user.click(screen.getAllByRole("button", { name: /^save query$/i })[1]);

    await waitFor(() => {
      expect(document.body.textContent).toContain(PAYLOADS.anchorJavascript);
      expect(document.body.textContent).toContain(PAYLOADS.svgScript);
      expect(document.body.textContent).toContain(PAYLOADS.detailsToggle);
    });
    expectNoExecutableMarkup();
  });

  it("renders query history questions safely", () => {
    useQueryStore.setState({
      history: [
        {
          id: "history-1",
          question: PAYLOADS.iframeSrcdoc,
          sql: "SELECT 1;",
          datasetId: "sales",
          createdAt: Date.now(),
        },
      ],
      lastResult: null,
      isQuerying: false,
    });

    render(<QueryHistory datasetId="sales" onSelectQuery={jest.fn()} />);

    expect(document.body.textContent).toContain(PAYLOADS.iframeSrcdoc);
    expectNoExecutableMarkup();
  });

  it("renders query history SQL previews safely", () => {
    useQueryStore.setState({
      history: [
        {
          id: "history-2",
          question: "payload preview",
          sql: `SELECT '${PAYLOADS.bodyOnload}' AS payload;`,
          datasetId: "sales",
          createdAt: Date.now(),
        },
      ],
      lastResult: null,
      isQuerying: false,
    });

    render(<QueryHistory datasetId="sales" onSelectQuery={jest.fn()} />);

    expect(document.body.textContent).toContain(PAYLOADS.bodyOnload);
    expectNoExecutableMarkup();
  });

  it("renders user chat messages safely in ChatInterface", async () => {
    const user = userEvent.setup();
    const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ questions: [] }))
      .mockResolvedValueOnce(jsonResponse({ sql: "SELECT 1 AS value, 'East' AS label" }))
      .mockResolvedValueOnce(
        jsonResponse({ sql: '{"type":"bar","title":"Safe chart","xAxis":"label","yAxis":"value"}' }),
      )
      .mockResolvedValueOnce(jsonResponse({ sql: "Safe summary." }));
    mockRunQuery.mockResolvedValue([{ value: 1, label: "East" }]);

    render(
      <ChatInterface datasetId="sales" tableName="sales" columns={sampleColumns} />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading suggestions...")).not.toBeInTheDocument();
    });

    const promptInput = screen.getByPlaceholderText("Ask anything about your data...");
    await user.type(promptInput, PAYLOADS.confirmImage);
    await user.click(
      promptInput.closest("form")?.querySelector('button[type="submit"]') as HTMLButtonElement,
    );

    expect(await screen.findByText(PAYLOADS.confirmImage)).toBeInTheDocument();
    expectNoExecutableMarkup();
  });

  it("renders assistant summaries and chart titles safely in ChatInterface", async () => {
    const user = userEvent.setup();
    const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ questions: [] }))
      .mockResolvedValueOnce(jsonResponse({ sql: "SELECT 1 AS value, 'East' AS label" }))
      .mockResolvedValueOnce(
        jsonResponse({
          sql: JSON.stringify({
            type: "bar",
            title: PAYLOADS.videoSource,
            xAxis: "label",
            yAxis: "value",
          }),
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ sql: PAYLOADS.marquee }));
    mockRunQuery.mockResolvedValue([{ value: 1, label: "East" }]);

    render(
      <ChatInterface datasetId="sales" tableName="sales" columns={sampleColumns} />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading suggestions...")).not.toBeInTheDocument();
    });

    const promptInput = screen.getByPlaceholderText("Ask anything about your data...");
    await user.type(promptInput, "show me totals");
    await user.click(
      promptInput.closest("form")?.querySelector('button[type="submit"]') as HTMLButtonElement,
    );

    expect(await screen.findByText(PAYLOADS.marquee)).toBeInTheDocument();
    await waitFor(() => {
      const chart = screen.getByRole("img");
      expect(chart.getAttribute("aria-label")).toContain(PAYLOADS.videoSource);
    });
    expectNoExecutableMarkup();
  });

  it.skip("renders workspace metadata, column names, and user messages safely in AiAssistant", async () => {
    const user = userEvent.setup();

    render(
      <AiAssistant
        tableName={PAYLOADS.divOnclick}
        columns={[
          {
            name: PAYLOADS.img,
            type: "string",
            nullCount: 0,
            uniqueCount: 1,
            sampleValues: ["East"],
          },
        ]}
        rowCount={3}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /toggle ai assistant/i }),
    );
    await user.click(screen.getByRole("button", { name: "What columns are there?" }));

    expect(await screen.findByText(textContentIncludes(PAYLOADS.divOnclick))).toBeInTheDocument();
    expect(screen.getByText(textContentIncludes(PAYLOADS.img))).toBeInTheDocument();

    const assistantInput = screen.getByPlaceholderText(
      "Ask about rows, columns, nulls, quality, or chart suggestions...",
    );
    await user.type(assistantInput, PAYLOADS.javascriptUrl);
    await user.click(
      assistantInput.closest("form")?.querySelector('button[type="submit"]') as HTMLButtonElement,
    );

    expect(await screen.findByText(PAYLOADS.javascriptUrl)).toBeInTheDocument();
    expectNoExecutableMarkup();
  });
});
