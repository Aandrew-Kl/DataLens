import {
  compilePipeline,
  createPipelineStep,
  toggleSelection,
  type PipelineStep,
} from "@/lib/utils/pipeline-builder";
import type { ColumnProfile } from "@/types/dataset";

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [10, 20],
  },
];

function makeStep(
  type: PipelineStep["type"],
  overrides: Partial<PipelineStep> = {},
): PipelineStep {
  return {
    ...createPipelineStep(type, columns),
    id: `${type}-1`,
    ...overrides,
  };
}

describe("pipeline-builder", () => {
  it("creates sensible defaults and toggles selected fields", () => {
    const aggregate = createPipelineStep("aggregate", columns);

    expect(aggregate.column).toBe("region");
    expect(aggregate.aggregateColumn).toBe("sales");
    expect(aggregate.groupColumns).toEqual(["region"]);
    expect(aggregate.sampleMode).toBe("rows");
    expect(aggregate.sampleSize).toBe(100);

    expect(toggleSelection(["region"], "sales")).toEqual(["region", "sales"]);
    expect(toggleSelection(["region", "sales"], "sales")).toEqual(["region"]);
  });

  it("returns a base select when no steps are provided", () => {
    expect(compilePipeline("orders", columns, [])).toEqual({
      sql: 'SELECT * FROM "orders"',
      columns: ["region", "sales", "profit"],
    });
  });

  it("compiles contains filters, count aggregates, and joins with selected right-side columns", () => {
    const compiled = compilePipeline("orders", columns, [
      makeStep("filter", {
        column: "region",
        operator: "contains",
        value: "ea",
      }),
      makeStep("aggregate", {
        groupColumns: ["region"],
        aggregateFunction: "COUNT",
        aggregateColumn: "sales",
        aggregateAlias: "row_count",
      }),
      makeStep("join", {
        joinTable: "segments",
        joinType: "LEFT",
        leftColumn: "region",
        rightColumn: "segment_region",
        rightColumns: "segment_name, score",
      }),
    ]);

    expect(compiled.sql).toContain(
      `LOWER(CAST("region" AS VARCHAR)) LIKE LOWER('%ea%')`,
    );
    expect(compiled.sql).toContain(`COUNT("sales") AS "row_count"`);
    expect(compiled.sql).toContain(
      `LEFT JOIN "segments" AS r ON l."region" = r."segment_region"`,
    );
    expect(compiled.sql).toContain(
      `r."segment_name" AS "join_segment_name", r."score" AS "join_score"`,
    );
    expect(compiled.columns).toEqual([
      "region",
      "row_count",
      "join_segment_name",
      "join_score",
    ]);
  });

  it("uses fallback names for rename, add-column, and remove-column steps", () => {
    const compiled = compilePipeline("orders", columns, [
      makeStep("rename", {
        column: "region",
        newName: "   ",
      }),
      makeStep("add-column", {
        newName: "   ",
        expression: "",
      }),
      makeStep("remove-column", {
        column: "profit",
        columns: [],
      }),
    ]);

    expect(compiled.sql).toContain(`"region" AS "region_renamed"`);
    expect(compiled.sql).toContain(`NULL AS "computed_column"`);
    expect(compiled.sql).toContain(`SELECT * EXCLUDE ("profit")`);
    expect(compiled.columns).toEqual([
      "region_renamed",
      "sales",
      "computed_column",
    ]);
  });

  it("falls back to deduplicating current columns and supports percent samples", () => {
    const compiled = compilePipeline("orders", columns, [
      makeStep("deduplicate", {
        columns: [],
      }),
      makeStep("sample", {
        sampleMode: "percent",
        sampleSize: 12.6,
      }),
    ]);

    expect(compiled.sql).toContain(
      `PARTITION BY "region", "sales", "profit" ORDER BY "region", "sales", "profit"`,
    );
    expect(compiled.sql).toContain(`USING SAMPLE 13 PERCENT`);
    expect(compiled.columns).toEqual(["region", "sales", "profit"]);
  });
});
