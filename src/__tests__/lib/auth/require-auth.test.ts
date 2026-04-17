import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { AUTH_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";
import { getDemoUser, isDemoMode } from "@/lib/auth/demo-mode";
import { requireAuth } from "@/lib/auth/require-auth";

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

jest.mock("jose", () => ({
  jwtVerify: jest.fn(),
}));

jest.mock("@/lib/auth/demo-mode", () => ({
  isDemoMode: jest.fn(),
  getDemoUser: jest.fn(),
}));

const mockJwtVerify = jwtVerify as jest.Mock;
const mockIsDemoMode = isDemoMode as jest.Mock;
const mockGetDemoUser = getDemoUser as jest.Mock;

const createRequest = ({
  headers,
  cookies,
}: {
  headers?: HeadersInit;
  cookies?: Record<string, string>;
} = {}) => {
  const request = {
    headers: new Headers(headers),
  } as {
    headers: Headers;
    cookies?: {
      get: jest.Mock;
    };
  };

  if (cookies) {
    request.cookies = {
      get: jest.fn((name: string) => {
        return Object.prototype.hasOwnProperty.call(cookies, name)
          ? { value: cookies[name] }
          : undefined;
      }),
    };
  }

  return request as unknown as Request;
};

async function expectJsonResponse(
  response: Awaited<ReturnType<typeof requireAuth>>,
  status: number,
  body: unknown
) {
  expect(response).toBeInstanceOf(NextResponse);
  expect((response as { status: number }).status).toBe(status);
  await expect(
    (response as { json: () => Promise<unknown> }).json()
  ).resolves.toEqual(body);
}

describe("requireAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDemoMode.mockReturnValue(false);
    mockGetDemoUser.mockReturnValue({
      id: "demo-user",
      email: "demo@datalens.local",
      name: "Demo User",
      isDemoUser: true,
    });
  });

  it("returns the demo user when demo mode is enabled", async () => {
    mockIsDemoMode.mockReturnValue(true);

    await expect(requireAuth(createRequest())).resolves.toEqual({ userId: "demo-user" });
    expect(mockGetDemoUser).toHaveBeenCalledTimes(1);
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it("returns 401 when no token is present", async () => {
    const response = await requireAuth(createRequest());

    await expectJsonResponse(response, 401, { error: "Unauthorized" });
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it("authenticates a bearer token and returns the subject as userId", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "bearer-user" },
    });

    await expect(
      requireAuth(
        createRequest({
          headers: { authorization: "Bearer bearer-token" },
        })
      )
    ).resolves.toEqual({ userId: "bearer-user" });

    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    expect(mockJwtVerify.mock.calls[0]?.[0]).toBe("bearer-token");
    expect(mockJwtVerify.mock.calls[0]?.[1]).toBeDefined();
  });

  it("authenticates the primary auth cookie via the NextRequest cookies accessor", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "cookie-user" },
    });

    await expect(
      requireAuth(
        createRequest({
          cookies: {
            [AUTH_TOKEN_COOKIE_NAME]: "cookie-token",
          },
        })
      )
    ).resolves.toEqual({ userId: "cookie-user" });

    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    expect(mockJwtVerify.mock.calls[0]?.[0]).toBe("cookie-token");
    expect(mockJwtVerify.mock.calls[0]?.[1]).toBeDefined();
  });

  it("falls back to cookie-header parsing for the legacy token cookie and preserves undecodable values", async () => {
    const malformedCookieValue = "%E0%A4%A";
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "legacy-user" },
    });

    await expect(
      requireAuth(
        createRequest({
          headers: { cookie: `token=${malformedCookieValue}` },
        })
      )
    ).resolves.toEqual({ userId: "legacy-user" });

    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    expect(mockJwtVerify.mock.calls[0]?.[0]).toBe(malformedCookieValue);
    expect(mockJwtVerify.mock.calls[0]?.[1]).toBeDefined();
  });

  it.each([
    ["malformed token", "malformed"],
    ["expired token", "jwt expired"],
    ["wrong signature", "signature verification failed"],
  ])("returns 401 when jwt verification fails for a %s", async (_label, message) => {
    mockJwtVerify.mockRejectedValueOnce(new Error(message));

    const response = await requireAuth(
      createRequest({
        headers: { authorization: "Bearer invalid-token" },
      })
    );

    await expectJsonResponse(response, 401, { error: "Invalid token" });
  });

  it("returns 401 when the verified token subject is empty", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "" },
    });

    const response = await requireAuth(
      createRequest({
        headers: { authorization: "Bearer empty-sub-token" },
      })
    );

    await expectJsonResponse(response, 401, { error: "Invalid token" });
  });
});
