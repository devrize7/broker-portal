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
import { isRealLoad } from "@/lib/load-countability";
import type { ArLoadRow } from "@/lib/customer-ar";

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
export interface FetchLoadsOptions {
  /**
   * Keep loads whose financials are incomplete — no revenue booked, or no
   * carrier booked against a $0 cost.
   *
   * Defaults to FALSE, so every margin-bearing surface in the portal gets the
   * same countability rule as the leaderboard. Pass true ONLY from a surface
   * that shows NO margin and needs the shipping record to be complete: the
   * customer client report is the one such caller. That customer shipped the
   * load and paid for it; dropping it because Oath has not finished keying its
   * own side would hand them a report that is short against their own records.
   */
  includeIncompleteFinancials?: boolean;
}

export async function fetchCountableLoads(
  options: FetchLoadsOptions = {}
): Promise<CountableLoad[]> {
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
    // Kept unmapped for the countability check below; defaulted at push time.
    rawCarrier: (r.carrier as string | null) ?? null,
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
    // The same countability rule the leaderboard applies (lib/load-countability.ts),
    // now enforced at the shared fetch so the broker pages, house accounts and
    // the sales contest cannot quote a margin the leaderboard already rejected.
    // Subsumes the old phantom $0/$0 rule, which was rule 1 seen in its most
    // obvious case.
    if (
      !options.includeIncompleteFinancials &&
      !isRealLoad({ revenue: row.revenue, carrierCost: row.carrierCost, carrier: row.rawCarrier })
    ) {
      continue;
    }
    // Even a caller that opts in gains nothing from a $0/$0 record.
    if (row.revenue === 0 && row.carrierCost === 0) continue;

    let weekKey: string;
    if (row.profWeek) {
      weekKey = row.profWeek;
    } else {
      weekKey = startOfWeek(row.pickupYmd);
      if (csvWeeks.has(weekKey)) continue;
    }

    const { profWeek: _drop, rawCarrier, ...rest } = row;
    loads.push({ ...rest, carrier: rawCarrier || "Unknown", weekKey });
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
 * Every open, un-written-off invoice in the book, for the AR rollup.
 *
 * Deliberately NOT status-filtered and NOT restricted to one broker: it mirrors
 * the dashboard's Collections query exactly (see lib/customer-ar.ts), so the
 * portal's "$X overdue" for a customer is the same number Jacob sees on the
 * Collections page. Scoping it to one broker's slice would produce a figure
 * that reconciles with nothing.
 */
export async function fetchOpenArRows(): Promise<ArLoadRow[]> {
  const result = await db.execute(
    `SELECT customer, invoiceBalance, invoiceDate, pickupDate,
            dunningHold, disputedAt, ptpDate
     FROM Load
     WHERE invoiceBalance > 0 AND writtenOffAt IS NULL`
  );

  return result.rows.map((r) => ({
    customer: String(r.customer ?? ""),
    invoiceBalance: Number(r.invoiceBalance) || 0,
    invoiceDate: (r.invoiceDate as string | null) ?? null,
    pickupDate: (r.pickupDate as string | null) ?? null,
    // SQLite has no boolean type — Prisma stores these as 0/1.
    dunningHold: Number(r.dunningHold) === 1,
    disputedAt: (r.disputedAt as string | null) ?? null,
    ptpDate: (r.ptpDate as string | null) ?? null,
  }));
}

/**
 * Loads credited to nobody currently active — the house accounts. Their rep has
 * departed (or the load never carried one), so no broker sees them on their own
 * page and nobody is chasing the customer. Admin-only by decision.
 */
export function houseAccountLoads(loads: CountableLoad[], roster: Roster): CountableLoad[] {
  return loads.filter((load) => !resolveActiveBroker(roster, load.salesRep).isActive);
}
