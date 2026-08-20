/**
 * The customer client report — a document a broker hands to their customer.
 *
 * Ported from the command center's `app/customers/[name]/report`, with two
 * deliberate differences that define this module:
 *
 *   1. NO MARGIN, ANYWHERE. Not in the returned shape, not derivable from it.
 *      The command center's version carries the same rule as a comment; here it
 *      is enforced by the type — `ReportLoad` has no cost field to leak, so a
 *      future edit cannot accidentally put profit on a page that goes to the
 *      customer. Revenue is what the customer already pays and already knows.
 *
 *   2. BROKER-SCOPED. The caller passes only the loads this broker ran with
 *      this customer, matching the rest of the portal (see
 *      app/api/broker/customer/route.ts). 22 of 102 customers run under more
 *      than one rep, so on a shared account these totals are a SUBSET of what
 *      the customer shipped with Oath. The report must disclose that on its
 *      face — a customer reconciling it against their own records will
 *      otherwise find it short, and conclude the numbers are wrong rather than
 *      partial.
 *
 * Everything here is pure so the report can be unit-tested without a DB.
 */

import { startOfWeek } from "@/lib/date-ranges";
import { summarizeOnTime, type OnTimeSummary } from "@/lib/on-time";

/**
 * One load, as the report sees it.
 *
 * Note what is absent: carrierCost, margin, commission. See the module note —
 * the omission is the point, not an oversight.
 */
export interface ReportLoad {
  loadNumber: string;
  /** Pickup as an America/New_York calendar date, `YYYY-MM-DD`. */
  pickupYmd: string;
  origin: string;
  destination: string;
  carrier: string;
  status: string;
  revenue: number;
  miles: number | null;
  deliveryDate: string | null;
  deliveryApptClose: string | null;
  deliveryActualArrival: string | null;
}

export interface ReportStats {
  totalRevenue: number;
  totalLoads: number;
  deliveredLoads: number;
  avgRevPerLoad: number;
  onTime: OnTimeSummary;
  /**
   * Null when the claims table could not be read — NOT zero. On a document the
   * customer receives, printing "0 claims" we could not verify is a false
   * assurance; "—" is honest.
   */
  claimsCount: number | null;
  claimsPct: number | null;
  /** Non-cancelled share of everything tendered. */
  acceptancePct: number;
  cancelledCount: number;
}

export interface ReportNetwork {
  statesCovered: number;
  carrierPartners: number;
  totalMiles: number;
  /** Mean pickup→delivery days over delivered loads with both dates. */
  avgTransitDays: number | null;
}

export interface WeeklyPoint {
  /** Monday of the week, `YYYY-MM-DD`. */
  weekStart: string;
  revenue: number;
  loads: number;
}

export interface LaneRow {
  lane: string;
  loads: number;
  revenue: number;
}

export interface CustomerReport {
  stats: ReportStats;
  network: ReportNetwork;
  weekly: WeeklyPoint[];
  topLanes: LaneRow[];
  /** ET date of the first load in range — "partner since". */
  firstLoadDate: string | null;
  lastLoadDate: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Dallas, TX" → "TX". Returns null for the Unknown placeholder or a bare city. */
function stateOf(location: string): string | null {
  if (!location || location === "Unknown") return null;
  const parts = location.split(",");
  if (parts.length < 2) return null;
  const state = parts[parts.length - 1].trim();
  return state && state !== "Unknown" ? state : null;
}

const HOW_MANY_LANES = 8;

/**
 * Build the report.
 *
 * @param loads      Countable loads for this broker + customer, already windowed.
 * @param cancelled  Cancelled loads for the same broker/customer/window. Kept
 *                   separate because cancelled loads are excluded from the
 *                   countable set everywhere else in the portal, but acceptance
 *                   rate is precisely a statement about them.
 * @param claimsCount Claims filed against this customer, or null if unreadable.
 */
export function buildCustomerReport(
  loads: ReportLoad[],
  cancelled: number,
  claimsCount: number | null
): CustomerReport {
  const totalLoads = loads.length;
  const totalRevenue = round2(loads.reduce((s, l) => s + l.revenue, 0));
  const delivered = loads.filter((l) => l.status.toLowerCase() === "delivered");

  // ── Weekly revenue ──
  const weeklyMap = new Map<string, WeeklyPoint>();
  for (const l of loads) {
    const weekStart = startOfWeek(l.pickupYmd);
    const entry = weeklyMap.get(weekStart) ?? { weekStart, revenue: 0, loads: 0 };
    entry.revenue += l.revenue;
    entry.loads++;
    weeklyMap.set(weekStart, entry);
  }
  const weekly = Array.from(weeklyMap.values())
    .map((w) => ({ ...w, revenue: round2(w.revenue) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // ── Top lanes, ranked by volume ──
  const laneMap = new Map<string, LaneRow>();
  for (const l of loads) {
    if (!l.origin || l.origin === "Unknown") continue;
    if (!l.destination || l.destination === "Unknown") continue;
    const lane = `${l.origin} → ${l.destination}`;
    const entry = laneMap.get(lane) ?? { lane, loads: 0, revenue: 0 };
    entry.loads++;
    entry.revenue += l.revenue;
    laneMap.set(lane, entry);
  }
  const topLanes = Array.from(laneMap.values())
    .map((r) => ({ ...r, revenue: round2(r.revenue) }))
    .sort((a, b) => b.loads - a.loads || b.revenue - a.revenue)
    .slice(0, HOW_MANY_LANES);

  // ── Network reach ──
  const states = new Set<string>();
  for (const l of loads) {
    const o = stateOf(l.origin);
    const d = stateOf(l.destination);
    if (o) states.add(o);
    if (d) states.add(d);
  }
  const carriers = new Set(
    loads.map((l) => l.carrier).filter((c) => c && c !== "Unknown")
  );

  const transitDays: number[] = [];
  for (const l of delivered) {
    if (!l.deliveryDate) continue;
    // Both sides parsed as UTC. `pickupYmd` is a bare calendar date, so anchoring
    // it at local noon while `deliveryDate` arrives as a UTC instant would make
    // average transit drift with the server's timezone — a different number on
    // Vercel than on a laptop. Noon UTC also keeps the day from rolling.
    const pickup = new Date(l.pickupYmd + "T12:00:00Z").getTime();
    const drop = new Date(l.deliveryDate).getTime();
    if (Number.isNaN(pickup) || Number.isNaN(drop)) continue;
    const days = (drop - pickup) / 86_400_000;
    // A negative transit is bad data, not a same-day miracle — drop it rather
    // than let it pull the average below zero.
    if (days >= 0) transitDays.push(days);
  }

  const sorted = [...loads].sort((a, b) => a.pickupYmd.localeCompare(b.pickupYmd));
  const tendered = totalLoads + cancelled;

  return {
    stats: {
      totalRevenue,
      totalLoads,
      deliveredLoads: delivered.length,
      avgRevPerLoad: totalLoads > 0 ? round2(totalRevenue / totalLoads) : 0,
      onTime: summarizeOnTime(loads),
      claimsCount,
      claimsPct:
        claimsCount === null || totalLoads === 0
          ? null
          : round2((claimsCount / totalLoads) * 100),
      // With nothing tendered there is nothing to accept; 100% would imply a
      // perfect record that was never tested.
      acceptancePct: tendered > 0 ? round2(((tendered - cancelled) / tendered) * 100) : 0,
      cancelledCount: cancelled,
    },
    network: {
      statesCovered: states.size,
      carrierPartners: carriers.size,
      totalMiles: Math.round(loads.reduce((s, l) => s + (l.miles ?? 0), 0)),
      avgTransitDays:
        transitDays.length > 0
          ? round2(transitDays.reduce((s, d) => s + d, 0) / transitDays.length)
          : null,
    },
    weekly,
    topLanes,
    firstLoadDate: sorted.length > 0 ? sorted[0].pickupYmd : null,
    lastLoadDate: sorted.length > 0 ? sorted[sorted.length - 1].pickupYmd : null,
  };
}
