/**
 * Shared load fetching + countability for the broker-scoped surfaces.
 *
 * Exists so the status filter, the phantom-load rule, the profitability-CSV
 * week rule and the ET date derivation are written ONCE. They were previously
 * copy-pasted per route, which is how this repo ended up with several drifted
 * five-status copies of the exclusion list.
 */

import { db } from "@/lib/db";
import type { Roster } from "@/lib/roster";
import { resolveActiveBroker } from "@/lib/broker-mapping";
import { startOfWeek } from "@/lib/date-ranges";

/**
 * Only dispatched-and-later loads count.
 *
 * `ready` is TAI's PRE-DISPATCH state: no carrier is assigned yet, so
 * carrierCost is $0 and the margin fakes the full revenue as profit (it inflated
 * the April 2026 leaderboard). It belongs in this list — freight-dashboard
 * `lib/domain/load-countability.ts` is the canonical copy and has carried it
 * since R9; this repo's copies were the documented drift. Adding it here is
 * behaviour-neutral on current data (prod holds zero `ready` rows) and closes
 * the hole before one appears.
 */
export const EXCLUDED_STATUSES = [
  "booked",
  "committed",
  "cancelled",
  "quote",
  "sent",
  "ready",
] as const;

export interface CountableLoad {
  loadNumber: string;
  customer: string;
  salesRep: string | null;
  /** Pickup as an America/New_York calendar date, `YYYY-MM-DD`. */
  pickupYmd: string;
  /** Monday of `pickupYmd`'s week, or the profWeek tag when the CSV supplied one. */
  weekKey: string;
  origin: string;
  destination: string;
  carrier: string;
  status: string;
  revenue: number;
  carrierCost: number;
  lumperRevenue: number;
  lumperCost: number;
}

/**
 * An instant → its America/New_York calendar date.
 *
 * Most pickup timestamps are pinned to noon UTC, where the UTC and ET dates
 * agree, but a minority sit at 00:00–05:00 UTC — which is the PREVIOUS evening
 * in New York. Slicing the ISO string would put those loads in the wrong day
 * (and, at a week boundary, the wrong week). Every date decision downstream —
 * range filtering, week bucketing, dormancy — reads this one field, so they can
 * never disagree with each other.
 */
export function etYmd(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Every countable load in the book, ET-dated and CSV-week-resolved.
 *
 * The whole table is ~4k rows and the previous implementation already scanned it
 * twice per request, so this stays a single unfiltered read and all slicing
 * happens in memory. That keeps the week rule below honest: it needs to see
 * which weeks the profitability CSV covered ACROSS the whole company, not just
 * within one broker's or one date range's slice.
 */
export async function fetchCountableLoads(): Promise<CountableLoad[]> {
  const placeholders = EXCLUDED_STATUSES.map(() => "?").join(",");
  const result = await db.execute({
    sql: `SELECT loadNumber, customer, salesRep, pickupDate, origin, destination,
                 carrier, status, revenue, carrierCost, lumperRevenue, lumperCost, profWeek
          FROM Load
          WHERE status NOT IN (${placeholders}) AND pickupDate IS NOT NULL`,
    args: [...EXCLUDED_STATUSES],
  });

  const raw = result.rows.map((r) => ({
    loadNumber: String(r.loadNumber ?? ""),
    customer: String(r.customer ?? ""),
    salesRep: (r.salesRep as string | null) ?? null,
    pickupYmd: etYmd(String(r.pickupDate)),
    origin: String(r.origin ?? ""),
    destination: String(r.destination ?? ""),
    carrier: (r.carrier as string | null) || "Unknown",
    status: String(r.status ?? ""),
    revenue: Number(r.revenue) || 0,
    carrierCost: Number(r.carrierCost) || 0,
    lumperRevenue: Number(r.lumperRevenue) || 0,
    lumperCost: Number(r.lumperCost) || 0,
    profWeek: (r.profWeek as string | null) || null,
  }));

  // Weeks the profitability CSV covered. Inside those weeks the CSV is ground
  // truth (it was pre-filtered), so an untagged load in the same week would be
  // double-counting something the CSV deliberately left out. Uploads stopped
  // around April 2026, so recent weeks all run on the pickup-date fallback.
  const csvWeeks = new Set<string>();
  for (const row of raw) if (row.profWeek) csvWeeks.add(row.profWeek);

  const loads: CountableLoad[] = [];
  for (const row of raw) {
    // Phantom $0/$0 loads carry no signal in either direction.
    if (row.revenue === 0 && row.carrierCost === 0) continue;

    let weekKey: string;
    if (row.profWeek) {
      weekKey = row.profWeek;
    } else {
      weekKey = startOfWeek(row.pickupYmd);
      if (csvWeeks.has(weekKey)) continue;
    }

    const { profWeek: _drop, ...rest } = row;
    loads.push({ ...rest, weekKey });
  }

  return loads;
}

/**
 * Narrow the book to one broker.
 *
 * Attribution follows `resolveActiveBroker`: a load listing several reps is
 * credited to the first ACTIVE one, matching the leaderboard exactly. A
 * consequence worth knowing when reading these screens — a customer shared with
 * a departed rep shows up wholly under the active broker who inherited it.
 */
export function loadsForBroker(
  loads: CountableLoad[],
  roster: Roster,
  broker: string
): CountableLoad[] {
  return loads.filter((load) => {
    const resolved = resolveActiveBroker(roster, load.salesRep);
    return resolved.isActive && resolved.broker === broker;
  });
}

/**
 * Loads credited to nobody currently active — the house accounts. Their rep has
 * departed (or the load never carried one), so no broker sees them on their own
 * page and nobody is chasing the customer. Admin-only by decision.
 */
export function houseAccountLoads(loads: CountableLoad[], roster: Roster): CountableLoad[] {
  return loads.filter((load) => !resolveActiveBroker(roster, load.salesRep).isActive);
}
