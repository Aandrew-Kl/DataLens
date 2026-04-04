import { middleware, config } from "@/middleware";
import { NextResponse } from "next/server";

jest.mock("next/server", () => ({
  NextResponse: {
    next: jest.fn(() => ({ type: "next" })),
    redirect: jest.fn((url) => ({
      type: "redirect",
      url: typeof url === "string" ? url : url.toString(),
    })),
  },
}));

const createMockRequest = (pathname: string, hasToken = false) => {
  const nextUrl = new URL(`http://localhost:3000${pathname === "/" ? "" : pathname}`);

  return {
    nextUrl: {
      pathname,
      clone: jest.fn(() => nextUrl),
      searchParams: nextUrl.searchParams,
    },
    cookies: {
      get: jest.fn((key: string) =>
        key === "datalens-auth-token" && hasToken ? { value: "token" } : null,
      ),
    },
    url: "http://localhost:3000",
  } as const;
};

describe("middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has the expected matcher config", () => {
    expect(config.matcher).toEqual([
      "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
    ]);
  });

  it("allows public routes without token", () => {
    const publicRoutes = ["/", "/login", "/register"];

    publicRoutes.forEach((pathname) => {
      const request = createMockRequest(pathname);
      const response = middleware(request as unknown as Parameters<typeof middleware>[0]);

      expect(response).toEqual({ type: "next" });
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  it("redirects to /login when accessing a protected route without token", () => {
    const request = createMockRequest("/dashboard");
    const response = middleware(request as unknown as Parameters<typeof middleware>[0]);

    expect(NextResponse.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/login",
        search: "?redirect=%2Fdashboard",
      }),
    );
    expect(response).toEqual({
      type: "redirect",
      url: "http://localhost:3000/login?redirect=%2Fdashboard",
    });
  });

  it("allows public auth routes even when a token exists", () => {
    const request = createMockRequest("/login", true);
    const response = middleware(request as unknown as Parameters<typeof middleware>[0]);

    expect(response).toEqual({ type: "next" });
    expect(NextResponse.next).toHaveBeenCalled();
  });

  it("allows protected routes when the auth cookie exists", () => {
    const request = createMockRequest("/dashboard", true);
    const response = middleware(request as unknown as Parameters<typeof middleware>[0]);

    expect(response).toEqual({ type: "next" });
    expect(NextResponse.next).toHaveBeenCalled();
  });
});
