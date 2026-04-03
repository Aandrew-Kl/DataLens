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
});
