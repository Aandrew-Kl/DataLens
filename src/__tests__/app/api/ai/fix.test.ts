import { NextResponse } from "next/server";
import { checkOllamaHealth, chat } from "@/lib/ai/ollama-client";
import { requireAuth } from "@/lib/auth/require-auth";
import { POST } from "@/app/api/ai/fix/route";

jest.mock("next/server", () => {
  class MockNextResponse {
    body: unknown;
    status: number;

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }

    async json() {
      return this.body;
    }

    static json = jest.fn((body: unknown, init?: { status?: number }) => {
      return new MockNextResponse(body, init);
    });
  }

  return {
    NextResponse: MockNextResponse,
  };
});

jest.mock("@/lib/auth/require-auth", () => ({
  requireAuth: jest.fn(),
}));

jest.mock("@/lib/ai/ollama-client", () => ({
  checkOllamaHealth: jest.fn().mockResolvedValue(false),
  chat: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockRequireAuth = requireAuth as jest.Mock;

const createRequest = (body: unknown) =>
  ({
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Request;

describe("POST /api/ai/fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: "test-user" });
  });

  it("returns 401 when authentication fails", async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await POST(createRequest({}));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const request = createRequest({});

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Missing required fields: sql, error, tableName, columns" });
    expect(checkOllamaHealth).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns an AI-generated fix when Ollama is healthy", async () => {
    const request = createRequest({
      sql: "SELECT id FROM users",
      error: "Binder Error: column not found",
      tableName: "users",
      columns: [{ name: "id", type: "number" }],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockResolvedValueOnce(
      '```json\n{"fixedSql":"SELECT \\"id\\" FROM \\"users\\"","explanation":"Quoted the identifiers for DuckDB."}\n```'
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      fixedSql: 'SELECT "id" FROM "users"',
      explanation: "Quoted the identifiers for DuckDB.",
      mode: "ai",
    });
  });

  it("returns fallback fix when Ollama unhealthy", async () => {
    const request = createRequest({
      sql: "SELCT * FORM users",
      error: "syntax error",
      tableName: "users",
      columns: [{ name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] }],
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      fixedSql: 'SELCT * FORM "users"',
      explanation: "Applied fallback fixes: quoted the table identifier.",
      mode: "fallback",
    });
    expect(checkOllamaHealth).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it("applies compatibility rewrites, quoting, and table normalization in fallback mode", async () => {
    const request = createRequest({
      sql: [
        "SELECT TOP 5 LEN(order_name) AS name_len, ISNULL(net_total, 0) == 1",
        "FROM sales_orders",
        "WHERE DATEPART(MONTH, order_date) = 1",
        "AND DATEDIFF(DAY, order_date, GETDATE()) > 0",
      ].join(" "),
      error: "syntax error near sales_orders",
      tableName: "sales orders",
      columns: [
        {
          name: "order name",
          type: "string",
          nullCount: 0,
          uniqueCount: 10,
          sampleValues: ["A"],
        },
        {
          name: "net total",
          type: "number",
          nullCount: 0,
          uniqueCount: 10,
          sampleValues: [1],
        },
        {
          name: "order date",
          type: "date",
          nullCount: 0,
          uniqueCount: 10,
          sampleValues: ["2026-01-01"],
        },
      ],
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe("fallback");
    expect(body.fixedSql).toContain('SELECT LENGTH("order name") AS name_len, COALESCE("net total", 0) = 1');
    expect(body.fixedSql).toContain('FROM "sales orders"');
    expect(body.fixedSql).toContain(`DATE_PART('month', "order date")`);
    expect(body.fixedSql).toContain(`DATE_DIFF('day', "order date", CURRENT_TIMESTAMP)`);
    expect(body.fixedSql).toContain("LIMIT 5");
    expect(body.explanation).toContain("converted DATEPART or DATEDIFF syntax to DuckDB equivalents");
    expect(body.explanation).toContain("quoted the column identifier");
  });

  it("corrects likely table and column names from the error message", async () => {
    const request = createRequest({
      sql: "SELECT ordr_total FROM sales_ordrs",
      error: 'Binder Error: column "ordr_total" not found in table "sales_ordrs"',
      tableName: "sales orders",
      columns: [
        {
          name: "order total",
          type: "number",
          nullCount: 0,
          uniqueCount: 10,
          sampleValues: [1],
        },
      ],
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      fixedSql: 'SELECT "order total" FROM "sales orders"',
      mode: "fallback",
    });
    expect(body.explanation).toContain(`corrected "ordr_total" to "order total"`);
    expect(body.explanation).toContain(
      `corrected the table name to "sales orders"`,
    );
  });

  it("returns normalization-only guidance when no confident fix can be inferred", async () => {
    const request = createRequest({
      sql: 'SELECT "id" FROM "users"',
      error: "unexpected parser failure",
      tableName: "users",
      columns: [{ name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] }],
    });

    const response = await POST(request);
    const body = await response.json();

    expect(body).toEqual({
      fixedSql: 'SELECT "id" FROM "users"',
      explanation:
        "No confident schema-specific repair was found, so the SQL was only normalized for DuckDB compatibility.",
      mode: "fallback",
    });
  });

  it("falls back when the upstream AI fixer throws", async () => {
    const request = createRequest({
      sql: "SELCT * FORM users",
      error: "syntax error",
      tableName: "users",
      columns: [{ name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] }],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockRejectedValueOnce(new Error("ollama offline"));

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      fixedSql: 'SELCT * FORM "users"',
      explanation: "Applied fallback fixes: quoted the table identifier.",
      mode: "fallback",
    });
  });

  it("falls back when Ollama responds with an unparseable payload", async () => {
    const request = createRequest({
      sql: "SELCT * FORM users",
      error: "syntax error",
      tableName: "users",
      columns: [{ name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] }],
    });

    (checkOllamaHealth as jest.Mock).mockResolvedValueOnce(true);
    (chat as jest.Mock).mockResolvedValueOnce("not valid json");

    const response = await POST(request);
    const body = await response.json();

    expect(body).toEqual({
      fixedSql: 'SELCT * FORM "users"',
      explanation: "Applied fallback fixes: quoted the table identifier.",
      mode: "fallback",
    });
  });
});
