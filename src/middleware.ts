import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";

const PUBLIC_ROUTES = new Set(["/", "/login", "/register"]);
const PUBLIC_API_ROUTES = new Set(["/api/health"]);

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasToken = Boolean(request.cookies.get(AUTH_TOKEN_COOKIE_NAME)?.value);
  const isApiRoute = pathname.startsWith("/api/");
  const isPublicRoute =
    PUBLIC_ROUTES.has(pathname) || PUBLIC_API_ROUTES.has(pathname);

  if (!isPublicRoute && hasToken === false) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
