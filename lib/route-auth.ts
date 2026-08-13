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

export interface PortalUser {
  brokerName?: string | null;
  isAdmin?: boolean;
}

/**
 * Discriminated on `ok`, not on `broker`. A bare `if (!broker)` can't narrow a
 * `string` field (the empty string is falsy but still the success variant), so
 * the compiler would leave `response` nullable at every call site.
 */
type BrokerAccessResult =
  | { ok: true; broker: string; isAdmin: boolean; response: null }
  | { ok: false; broker: null; isAdmin: false; response: NextResponse };

/**
 * THE gate for every per-broker data route: a broker may read their own book
 * and nothing else; an admin (Jacob / Kevin / Brett — `ADMIN_EMAILS`) may
 * read anyone's.
 *
 * Centralised on purpose. This rule is the whole promise made to the team about
 * the portal ("you can only see your own numbers"), and it was previously
 * hand-rolled inline in the one route that needed it. Every new broker-scoped
 * route must call this rather than re-deriving the comparison — a second copy is
 * a second chance to get it subtly wrong.
 *
 * Returns 403 for both "not allowed" AND "no broker named", so the endpoint
 * can't be used to probe which broker names exist.
 */
export async function requireBrokerAccess(
  requestedBroker: string | null | undefined
): Promise<BrokerAccessResult> {
  const { session, response } = await requireSession();
  if (!session) return { ok: false, broker: null, isAdmin: false, response };

  const user = session.user as PortalUser | undefined;
  const isAdmin = user?.isAdmin ?? false;
  const broker = requestedBroker?.trim();

  if (!broker || (!isAdmin && user?.brokerName !== broker)) {
    return {
      ok: false,
      broker: null,
      isAdmin: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, broker, isAdmin, response: null };
}

/** Admin-only routes (the cross-broker house-accounts view). */
export async function requireAdmin(): Promise<
  { isAdmin: true; response: null } | { isAdmin: false; response: NextResponse }
> {
  const { session, response } = await requireSession();
  if (!session) return { isAdmin: false, response };

  const user = session.user as PortalUser | undefined;
  if (!user?.isAdmin) {
    return { isAdmin: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { isAdmin: true, response: null };
}
