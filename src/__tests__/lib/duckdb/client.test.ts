const queryMock = jest.fn();
const connectMock = jest.fn();
const instantiateMock = jest.fn();
const registerFileTextMock = jest.fn();
const getJsDelivrBundlesMock = jest.fn().mockReturnValue({});
const selectBundleMock = jest.fn().mockResolvedValue({
  mainWorker: "w",
  mainModule: "m",
  pthreadWorker: "p",
});

class AsyncDuckDBMock {
  public instantiate = instantiateMock;
  public connect = connectMock;
  public registerFileText = registerFileTextMock;
}

class AsyncDuckDBConnectionMock {
  public query = queryMock;
}

jest.mock("@duckdb/duckdb-wasm", () => ({
  getJsDelivrBundles: getJsDelivrBundlesMock,
  selectBundle: selectBundleMock,
  AsyncDuckDB: jest.fn(() => new AsyncDuckDBMock()),
  AsyncDuckDBConnection: AsyncDuckDBConnectionMock,
  ConsoleLogger: class {
    constructor() {
      return {};
    }
  },
}));

describe("duckdb client", () => {
  const loadDuckDBClient = async () => {
    jest.resetModules();

    return import("@/lib/duckdb/client");
  };

  beforeEach(() => {
    queryMock
      .mockReset()
      .mockResolvedValue({
        toArray: () => [{ col: 1 }],
        schema: {
          fields: [{ name: "col" }],
        },
      });

    connectMock.mockReset().mockResolvedValue({ query: queryMock });
    instantiateMock.mockReset().mockResolvedValue(undefined);
    registerFileTextMock.mockReset().mockResolvedValue(undefined);

    (globalThis as unknown as { Worker: (...args: unknown[]) => unknown }).Worker =
      jest.fn(() => ({}));
  });

  test("runQuery returns parsed rows", async () => {
    const { runQuery } = await loadDuckDBClient();

    const rows = await runQuery("SELECT * FROM test_table");

    expect(rows).toEqual([{ col: 1 }]);
    expect(queryMock).toHaveBeenCalledWith("SELECT * FROM test_table");
  });

  test("loadCSVIntoDB registers file and creates table", async () => {
    const { loadCSVIntoDB } = await loadDuckDBClient();
    const tableName = "sales_csv";
    const csvContent = "id,name\\n1,Alice\\n";

    await loadCSVIntoDB(tableName, csvContent);

    expect(registerFileTextMock).toHaveBeenCalledWith(tableName + ".csv", csvContent);
    expect(queryMock).toHaveBeenCalledWith(
      'CREATE OR REPLACE TABLE "' +
        tableName +
        '" AS SELECT * FROM read_csv_auto(\'' +
        tableName +
        '.csv\', header=true, sample_size=-1)',
    );
  });

  test("loadJSONIntoDB registers file and creates table", async () => {
    const { loadJSONIntoDB } = await loadDuckDBClient();
    const tableName = "sales_json";
    const jsonContent = '{"id":1,"name":"Alice"}';

    await loadJSONIntoDB(tableName, jsonContent);

    expect(registerFileTextMock).toHaveBeenCalledWith(tableName + ".json", jsonContent);
    expect(queryMock).toHaveBeenCalledWith(
      'CREATE OR REPLACE TABLE "' +
        tableName +
        '" AS SELECT * FROM read_json_auto(\'' +
        tableName +
        '.json\')',
    );
  });

  test("getTableSchema returns column info", async () => {
    queryMock.mockResolvedValue({
      toArray: () => [
        { column_name: "id", column_type: "INTEGER" },
        { column_name: "name", column_type: "VARCHAR" },
      ],
      schema: {
        fields: [{ name: "unused" }],
      },
    });

    const { getTableSchema } = await loadDuckDBClient();

    const schema = await getTableSchema("events");

    expect(schema).toEqual([
      { name: "id", type: "INTEGER" },
      { name: "name", type: "VARCHAR" },
    ]);
    expect(queryMock).toHaveBeenCalledWith('DESCRIBE "events"');
  });

  test("getTableRowCount returns row count", async () => {
    queryMock.mockResolvedValue({
      toArray: () => [{ cnt: 5 }],
      schema: {
        fields: [{ name: "cnt" }],
      },
    });

    const { getTableRowCount } = await loadDuckDBClient();

    const rowCount = await getTableRowCount("events");

    expect(rowCount).toBe(5);
    expect(queryMock).toHaveBeenCalledWith('SELECT COUNT(*) as cnt FROM "events"');
  });

  test("dropTable executes DROP TABLE", async () => {
    const { dropTable } = await loadDuckDBClient();

    await dropTable("events");

    expect(queryMock).toHaveBeenCalledWith('DROP TABLE IF EXISTS "events"');
  });
});
