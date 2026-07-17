import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;

  // NextAuth's own sign-in / callback routes and the login page are public.
  if (pathname.startsWith("/api/auth") || pathname === "/login") {
    return NextResponse.next();
  }

  // API routes: reject unauthenticated callers with a clean 401 JSON rather
  // than an HTML login redirect, so fetch() callers see a real status. This is
  // only an optimistic cookie pre-filter — each handler re-verifies the session
  // via requireSession() (see lib/route-auth.ts), which is the real gate.
  // (/api/leaderboard used to be whitelisted here, which leaked full broker
  // performance data to unauthenticated requests — now gated like the rest.)
  if (pathname.startsWith("/api/")) {
    if (!req.auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Pages: redirect unauthenticated users to the login screen.
  if (!req.auth) {
    const signInUrl = new URL("/login", req.url);
    signInUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signInUrl);
  }

  // Brokers can only access their own drill-down page
  if (pathname.startsWith("/broker/")) {
    const user = req.auth.user as { brokerName?: string | null; isAdmin?: boolean };
    if (user.isAdmin) return NextResponse.next();

    const brokerName = user.brokerName;
    const requestedName = decodeURIComponent(pathname.split("/broker/")[1] ?? "");
    if (brokerName && requestedName && brokerName !== requestedName) {
      return NextResponse.redirect(
        new URL(`/broker/${encodeURIComponent(brokerName)}`, req.url)
      );
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
