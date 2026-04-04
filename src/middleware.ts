import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";

const PUBLIC_ROUTES = new Set(["/", "/login", "/register"]);

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasToken = Boolean(request.cookies.get(AUTH_TOKEN_COOKIE_NAME)?.value);
  const isPublicRoute =
    PUBLIC_ROUTES.has(pathname) || pathname.startsWith("/api/");

  if (!isPublicRoute && hasToken === false) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
