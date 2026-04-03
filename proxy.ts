import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;

  // Always allow login and auth API routes
  if (pathname.startsWith("/api/auth") || pathname === "/login") {
    return NextResponse.next();
  }

  // Require sign-in for everything else
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
