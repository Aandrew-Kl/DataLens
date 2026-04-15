import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { AUTH_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-in-production"
);

function getCookieValue(request: Request | NextRequest, name: string): string | undefined {
  const nextCookie = (request as NextRequest).cookies?.get(name)?.value;
  if (nextCookie) {
    return nextCookie;
  }

  const cookieHeader = request.headers.get("cookie");
  const cookie = cookieHeader
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  if (!cookie) {
    return undefined;
  }

  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return cookie.slice(name.length + 1);
  }
}

export async function requireAuth(
  request: NextRequest
): Promise<{ userId: string } | NextResponse>;
export async function requireAuth(
  request: Request
): Promise<{ userId: string } | NextResponse>;
export async function requireAuth(
  request: Request | NextRequest
): Promise<{ userId: string } | NextResponse> {
  const token =
    getCookieValue(request, AUTH_TOKEN_COOKIE_NAME) ||
    getCookieValue(request, "token") ||
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    return { userId: payload.sub };
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
