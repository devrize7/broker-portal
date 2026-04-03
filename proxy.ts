import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/broker")) {
    if (!req.auth) {
      const signInUrl = new URL("/login", req.url);
      signInUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(signInUrl);
    }
    // Admins can access any broker's drill-down
    const user = req.auth.user as { brokerName?: string | null; isAdmin?: boolean };
    if (user.isAdmin) return NextResponse.next();

    // Brokers can only access their own drill-down
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
  matcher: ["/broker/:path*"],
};
