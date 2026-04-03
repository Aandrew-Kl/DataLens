import {
  STEP_META,
  compilePipeline,
  createPipelineStep,
  toggleSelection,
  type PipelineStep,
} from "@/lib/utils/pipeline-builder";
import type { ColumnProfile } from "@/types/dataset";

const baseColumns: ColumnProfile[] = [
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
];

function makeStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    ...createPipelineStep("filter", baseColumns),
    id: "step-1",
    type: "filter",
    column: "region",
    operator: "=",
    value: "East",
    ...overrides,
  };
}

describe("createPipelineStep", () => {
  it("seeds defaults from the available columns and step metadata", () => {
    const step = createPipelineStep("aggregate", baseColumns);

    expect(step).toMatchObject({
      type: "aggregate",
      column: "region",
      columns: ["region"],
      groupColumns: ["region"],
      aggregateFunction: "COUNT",
      aggregateColumn: "sales",
      aggregateAlias: "metric_value",
      newName: "region_new",
      sampleMode: "rows",
      sampleSize: 100,
    });
    expect(STEP_META.aggregate).toEqual({
      label: "Aggregate",
      hint: "Compute a summary metric.",
    });
  });
});

describe("toggleSelection", () => {
  it("adds missing names and removes existing ones", () => {
    expect(toggleSelection(["region"], "sales")).toEqual(["region", "sales"]);
    expect(toggleSelection(["region", "sales"], "region")).toEqual(["sales"]);
  });
});

describe("compilePipeline", () => {
  it("returns a base SELECT when there are no pipeline steps", () => {
    expect(compilePipeline("orders", baseColumns, [])).toEqual({
      sql: 'SELECT * FROM "orders"',
      columns: ["region", "sales"],
    });
  });

  it("builds contains filters and rounded percent samples", () => {
    const result = compilePipeline("orders", baseColumns, [
      makeStep({
        type: "filter",
        operator: "contains",
        value: "ea",
      }),
      makeStep({
        id: "step-2",
        type: "sample",
        sampleMode: "percent",
        sampleSize: 12.6,
      }),
    ]);

    expect(result.sql).toContain(
      `LOWER(CAST("region" AS VARCHAR)) LIKE LOWER('%ea%')`,
    );
    expect(result.sql).toContain("USING SAMPLE 13 PERCENT");
    expect(result.columns).toEqual(["region", "sales"]);
  });

  it("updates column projections through grouping, aggregation, and renaming", () => {
    const result = compilePipeline("orders", baseColumns, [
      makeStep({
        type: "group",
        groupColumns: ["region"],
      }),
      makeStep({
        id: "step-2",
        type: "aggregate",
        groupColumns: ["region"],
        aggregateFunction: "SUM",
        aggregateColumn: "sales",
        aggregateAlias: "total_sales",
      }),
      makeStep({
        id: "step-3",
        type: "rename",
        column: "region",
        newName: "market",
      }),
    ]);

    expect(result.sql).toContain('GROUP BY "region"');
    expect(result.sql).toContain('SUM("sales") AS "total_sales"');
    expect(result.sql).toContain('SELECT "region" AS "market", "total_sales"');
    expect(result.columns).toEqual(["market", "total_sales"]);
  });

  it("supports joins, computed columns, casts, column removal, and deduplication", () => {
    const result = compilePipeline("orders", baseColumns, [
      makeStep({
        type: "join",
        joinType: "INNER",
        joinTable: "targets",
        leftColumn: "region",
        rightColumn: "region",
        rightColumns: "quota, owner",
      }),
      makeStep({
        id: "step-2",
        type: "add-column",
        newName: "sales_with_tax",
        expression: '"sales" * 1.2',
      }),
      makeStep({
        id: "step-3",
        type: "cast",
        column: "sales",
        newType: "DOUBLE",
      }),
      makeStep({
        id: "step-4",
        type: "remove-column",
        columns: ["region"],
      }),
      makeStep({
        id: "step-5",
        type: "deduplicate",
        columns: ["join_quota"],
      }),
    ]);

    expect(result.sql).toContain(
      'INNER JOIN "targets" AS r ON l."region" = r."region"',
    );
    expect(result.sql).toContain('r."quota" AS "join_quota"');
    expect(result.sql).toContain('r."owner" AS "join_owner"');
    expect(result.sql).toContain('"sales" * 1.2 AS "sales_with_tax"');
    expect(result.sql).toContain('CAST("sales" AS DOUBLE) AS "sales"');
    expect(result.sql).toContain('EXCLUDE ("region")');
    expect(result.sql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY "join_quota" ORDER BY "join_quota")',
    );
    expect(result.columns).toEqual([
      "sales",
      "join_quota",
      "join_owner",
      "sales_with_tax",
    ]);
  });
});
