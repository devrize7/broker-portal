/**
 * ROUTE-HANDLER AUTH GUARD — the primary session gate for `app/api/*`.
 *
 * MIRROR of freight-dashboard `lib/route-auth.ts` (the P0.1 sweep, PRs
 * #312-#318). The `proxy.ts` cookie check is only an OPTIMISTIC pre-filter —
 * Next's own docs are explicit that the proxy "should not be your only line of
 * defense" and that Route Handlers must "verify if the user is allowed to
 * access the Route Handler" as close to the data as possible. So every data
 * route confirms the NextAuth session here before touching the DB.
 *
 * Usage:
 *   const { session, response } = await requireSession();
 *   if (!session) return response;   // 401 JSON, unauthenticated
 */
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

type RequireSessionResult =
  | { session: Session; response: null }
  | { session: null; response: NextResponse };

export async function requireSession(): Promise<RequireSessionResult> {
  const session = await auth();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, response: null };
}
