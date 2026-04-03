import { runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);

const schema = [
  { column_name: "id", column_type: "INTEGER" },
  { column_name: "name", column_type: "VARCHAR" },
];

function makeRunQueryMock() {
  mockRunQuery.mockReset();
  mockRunQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('DESCRIBE "users"')) {
      return schema;
    }

    if (sql.includes('COUNT(*) - COUNT("id")')) {
      return [
        {
          null_count: 1,
          unique_count: 2,
        },
      ];
    }

    if (sql.includes('COUNT(*) - COUNT("name")')) {
      return [
        {
          null_count: 3,
          unique_count: 4,
        },
      ];
    }

    if (sql.includes('SELECT DISTINCT "id" AS val')) {
      return [{ val: 1 }, { val: 2 }, { val: 3 }];
    }

    if (sql.includes('SELECT DISTINCT "name" AS val')) {
      return [{ val: "Ada" }, { val: "Grace" }];
    }

    if (sql.includes('MIN("id") AS min_val')) {
      return [
        {
          min_val: 1,
          max_val: 3,
          mean_val: 2,
          median_val: 2,
        },
      ];
    }

    return [];
  });
}

describe("profileTable", () => {
  it("returns mapped column types for INTEGER and VARCHAR", async () => {
    makeRunQueryMock();

    const profiles = await profileTable("users");
    const expected: Array<Pick<ColumnProfile, "name" | "type">> = [
      { name: "id", type: "number" },
      { name: "name", type: "string" },
    ];

    expect(profiles).toHaveLength(2);
    expect(profiles.map((profile) => ({ name: profile.name, type: profile.type }))).toEqual(
      expected,
    );
  });

  it("sets nullCount and uniqueCount from stats query", async () => {
    makeRunQueryMock();

    const profiles = await profileTable("users");

    expect(profiles[0]).toMatchObject({
      name: "id",
      nullCount: 1,
      uniqueCount: 2,
    });
    expect(profiles[1]).toMatchObject({
      name: "name",
      nullCount: 3,
      uniqueCount: 4,
    });
  });

  it("includes sample values for each column", async () => {
    makeRunQueryMock();

    const profiles = await profileTable("users");

    expect(profiles[0].sampleValues).toEqual([1, 2, 3]);
    expect(profiles[1].sampleValues).toEqual(["Ada", "Grace"]);
  });
});
