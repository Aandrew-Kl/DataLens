import * as duckdb from "@duckdb/duckdb-wasm";

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

export async function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (db) return db;

  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger();

  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  return db;
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (conn) return conn;
  const database = await initDuckDB();
  conn = await database.connect();
  return conn;
}

export async function runQuery(sql: string): Promise<Record<string, unknown>[]> {
  const connection = await getConnection();
  const result = await connection.query(sql);
  return result.toArray().map((row) => {
    const obj: Record<string, unknown> = {};
    for (const field of result.schema.fields) {
      const val = row[field.name];
      // Handle BigInt serialization
      obj[field.name] = typeof val === "bigint" ? Number(val) : val;
    }
    return obj;
  });
}

export async function loadCSVIntoDB(
  tableName: string,
  csvContent: string
): Promise<void> {
  const database = await initDuckDB();
  await database.registerFileText(`${tableName}.csv`, csvContent);
  const connection = await getConnection();
  await connection.query(
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${tableName}.csv', header=true, sample_size=-1)`
  );
}

export async function loadJSONIntoDB(
  tableName: string,
  jsonContent: string
): Promise<void> {
  const database = await initDuckDB();
  await database.registerFileText(`${tableName}.json`, jsonContent);
  const connection = await getConnection();
  await connection.query(
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${tableName}.json')`
  );
}

export async function getTableSchema(
  tableName: string
): Promise<{ name: string; type: string }[]> {
  const connection = await getConnection();
  const result = await connection.query(
    `DESCRIBE "${tableName}"`
  );
  return result.toArray().map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
  }));
}

export async function getTableRowCount(tableName: string): Promise<number> {
  const connection = await getConnection();
  const result = await connection.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
  const rows = result.toArray();
  return Number(rows[0].cnt);
}

export async function dropTable(tableName: string): Promise<void> {
  const connection = await getConnection();
  await connection.query(`DROP TABLE IF EXISTS "${tableName}"`);
}
