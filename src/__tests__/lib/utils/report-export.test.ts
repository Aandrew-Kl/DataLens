import { generateReportHTML } from "@/lib/utils/report-export";
import type { ReportConfig } from "@/types/report";

function makeConfig(overrides: Partial<ReportConfig> = {}): ReportConfig {
  return {
    title: "Quarterly Report",
    description: "Performance overview",
    createdAt: 1_700_000_000_000,
    widgets: [],
    ...overrides,
  };
}

describe("generateReportHTML", () => {
  it("renders the report shell, fallback description, and empty-state widgets", () => {
    const config = makeConfig({
      title: 'Quarterly <Report>',
      description: "",
      widgets: [],
    });

    const html = generateReportHTML(config, {});

    expect(html).toContain("<h1>Quarterly &lt;Report&gt;</h1>");
    expect(html).toContain("Generated analytical report.");
    expect(html).toContain(
      new Date(config.createdAt).toLocaleString(),
    );
    expect(html).toContain("<span class=\"muted\">Widgets</span>");
    expect(html).toContain("This report has no widgets.");
    expect(html).toContain("<span class=\"muted\">Charts</span>");
    expect(html).toContain("<strong>0</strong>");
  });

  it("renders text widgets as escaped paragraph blocks with line breaks", () => {
    const config = makeConfig({
      widgets: [
        {
          id: "text-1",
          type: "text",
          content: "First line\nSecond <line>\n\nNext block",
        },
      ],
    });

    const html = generateReportHTML(config, {});

    expect(html).toContain("<h2>Text Block</h2>");
    expect(html).toContain("<p>First line<br />Second &lt;line&gt;</p>");
    expect(html).toContain("<p>Next block</p>");
  });

  it("renders a fallback message when a text widget has no content", () => {
    const config = makeConfig({
      widgets: [
        {
          id: "text-empty",
          type: "text",
          content: "   ",
        },
      ],
    });

    const html = generateReportHTML(config, {});

    expect(html).toContain('<p class="muted">No content provided.</p>');
  });

  it("formats metric widgets and surfaces escaped widget errors", () => {
    const config = makeConfig({
      widgets: [
        {
          id: "metric-ok",
          type: "metric",
          label: "Revenue",
          sql: 'SELECT SUM("revenue") FROM "sales"',
          format: "currency",
        },
        {
          id: "metric-error",
          type: "metric",
          label: "Failed KPI",
          sql: "SELECT bad_sql",
        },
      ],
    });

    const html = generateReportHTML(config, {
      "metric-ok": [{ total: 1234.56 }],
      "metric-error": [{ __error: "Bad <sql>" }],
    });

    expect(html).toContain("<h2>Revenue</h2>");
    expect(html).toContain("$1,234.56");
    expect(html).toContain("Bad &lt;sql&gt;");
  });

  it("renders chart widgets with data tables, visual bars, and escaped SQL", () => {
    const config = makeConfig({
      widgets: [
        {
          id: "chart-1",
          type: "chart",
          chartType: "bar",
          title: "Revenue by Region",
          sql: 'SELECT * FROM "sales"',
          xAxis: "region",
          yAxis: "revenue",
        },
      ],
    });

    const html = generateReportHTML(config, {
      "chart-1": [
        { region: "East", revenue: 50 },
        { region: "West", revenue: 100 },
      ],
    });

    expect(html).toContain("<span class=\"eyebrow\">bar chart</span>");
    expect(html).toContain("<h2>Revenue by Region</h2>");
    expect(html).toContain("region x revenue");
    expect(html).toContain("<th>Visual</th>");
    expect(html).toContain("<td class=\"row-index\">1</td>");
    expect(html).toContain("<div class=\"bar-fill\" style=\"width:50%\"></div>");
    expect(html).toContain(
      '<pre class="sql-block">SELECT * FROM &quot;sales&quot;</pre>',
    );
  });

  it("formats metric widgets across percent, compact, default, and non-numeric values", () => {
    const config = makeConfig({
      widgets: [
        {
          id: "metric-percent",
          type: "metric",
          label: "Conversion",
          sql: "SELECT 0.125",
          format: "percent",
        },
        {
          id: "metric-compact",
          type: "metric",
          label: "Visitors",
          sql: "SELECT 1200000",
          format: "compact",
        },
        {
          id: "metric-default",
          type: "metric",
          label: "Orders",
          sql: "SELECT 1000",
        },
        {
          id: "metric-boolean",
          type: "metric",
          label: "Enabled",
          sql: "SELECT false",
        },
        {
          id: "metric-object",
          type: "metric",
          label: "Payload",
          sql: "SELECT payload",
        },
      ],
    });

    const html = generateReportHTML(config, {
      "metric-percent": [{ ratio: "0.125" }],
      "metric-compact": [{ total: 1_200_000 }],
      "metric-default": [{ total: 1000 }],
      "metric-boolean": [{ enabled: false }],
      "metric-object": [{ payload: { region: "East" } }],
    });

    expect(html).toContain("12.5%");
    expect(html).toContain("1.2M");
    expect(html).toContain(">1,000<");
    expect(html).toContain(">No<");
    expect(html).toContain("{&quot;region&quot;:&quot;East&quot;}");
  });

  it("renders chart empty and zero-width visual states for missing or non-numeric values", () => {
    const config = makeConfig({
      widgets: [
        {
          id: "chart-empty",
          type: "chart",
          chartType: "bar",
          title: "No rows",
          sql: "SELECT * FROM sales",
          xAxis: "region",
          yAxis: "revenue",
        },
        {
          id: "chart-weird",
          type: "chart",
          chartType: "bar",
          title: "Mixed values",
          sql: "SELECT * FROM sales",
          xAxis: "region",
          yAxis: "revenue",
        },
        {
          id: "chart-no-visual",
          type: "chart",
          chartType: "bar",
          title: "Missing metric key",
          sql: "SELECT * FROM sales",
          xAxis: "region",
          yAxis: "missing_metric",
        },
      ],
    });

    const html = generateReportHTML(config, {
      "chart-empty": [],
      "chart-weird": [
        { region: "East", revenue: "0.1" },
        { region: "West", revenue: "oops" },
        { region: "South", revenue: -5 },
      ],
      "chart-no-visual": [{ region: "North" }],
    });

    expect(html).toContain("No rows returned for this widget.");
    expect(html).toContain("style=\"width:2%\"");
    expect(html).toContain("style=\"width:0%\"");
    expect(html).toContain("style=\"width:100%\"");
    expect(html).toContain("Missing metric key");
    expect(html.match(/<th>Visual<\/th>/g) ?? []).toHaveLength(1);
  });
});
