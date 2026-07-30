import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-auth";
import { getRoster } from "@/lib/roster";
import { fetchCountableLoads, houseAccountLoads } from "@/lib/load-query";
import { buildCustomerBook, DORMANT_DAYS } from "@/lib/customer-book";
import { parsePreset, resolveRange, todayET } from "@/lib/date-ranges";
import { resolveActiveBroker } from "@/lib/broker-mapping";

export const dynamic = "force-dynamic";

/**
 * HOUSE ACCOUNTS — customers whose only rep has departed (or who never carried
 * one). Nobody sees them on a broker page, so nobody is chasing them, and some
 * are substantial: Dewar Nurseries sat at 39 loads under a departed rep.
 *
 * ADMIN ONLY, by decision (Jacob, 2026-07-29). Showing unclaimed accounts to
 * every broker would invite two brokers working the same customer; the
 * reassignment call belongs to Jacob and Kevin.
 *
 * These are read straight off load attribution, not an ownership record — one
 * doesn't exist. `salesRep` is also a TAI creation-time snapshot that is never
 * cleared, so a name here means "the last rep TAI stamped", not "the rep who
 * owns it today".
 */
export async function GET(req: NextRequest) {
  const { isAdmin, response } = await requireAdmin();
  if (!isAdmin) return response;

  const params = req.nextUrl.searchParams;
  const range = resolveRange(parsePreset(params.get("preset")), {
    from: params.get("from"),
    to: params.get("to"),
  });
  const today = todayET();

  try {
    const [roster, allLoads] = await Promise.all([getRoster(), fetchCountableLoads()]);
    const loads = houseAccountLoads(allLoads, roster);

    const book = buildCustomerBook(
      loads.map((l) => ({
        customer: l.customer,
        pickupDate: l.pickupYmd,
        revenue: l.revenue,
        carrierCost: l.carrierCost,
        lumperRevenue: l.lumperRevenue,
        lumperCost: l.lumperCost,
      })),
      { today, rangeFrom: range.from, rangeToExclusive: range.toExclusive }
    );

    // Last rep TAI stamped on each customer's most recent load — the "who had
    // this" column. Departed or blank by construction; that's the point.
    const lastRep = new Map<string, { rep: string; on: string }>();
    for (const load of loads) {
      const customer = load.customer.trim();
      if (!customer) continue;
      const current = lastRep.get(customer);
      if (!current || load.pickupYmd > current.on) {
        lastRep.set(customer, {
          rep: resolveActiveBroker(roster, load.salesRep).broker,
          on: load.pickupYmd,
        });
      }
    }

    const withRep = (entries: typeof book.active) =>
      entries.map((entry) => ({ ...entry, lastRep: lastRep.get(entry.customer)?.rep ?? "Unassigned" }));

    // Dormant first: a house account still running is being served by somebody,
    // while a lapsed one is unattended revenue and the reason this page exists.
    return NextResponse.json({
      range: { preset: range.preset, label: range.label, from: range.from, to: range.toDisplay },
      dormant: withRep(book.dormant),
      active: withRep(book.active),
      dormantDays: DORMANT_DAYS,
      periodTotals: book.periodTotals,
      lifetimeMargin: book.active
        .concat(book.dormant)
        .reduce((sum, c) => sum + c.lifetime.margin, 0),
    });
  } catch (err) {
    console.error("House accounts error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
