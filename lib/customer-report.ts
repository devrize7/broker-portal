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

export type VolumeBucket = "weekly" | "biweekly" | "monthly";

export interface VolumePoint {
  /** First day of the bucket, `YYYY-MM-DD`. */
  start: string;
  revenue: number;
  loads: number;
}

export interface VolumeTrend {
  bucket: VolumeBucket;
  points: VolumePoint[];
}

export interface LaneRow {
  lane: string;
  loads: number;
  revenue: number;
}

export interface CustomerReport {
  stats: ReportStats;
  network: ReportNetwork;
  volume: VolumeTrend;
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

/** Whole weeks spanned by two ET dates, inclusive of both ends. */
function weeksSpanned(fromYmd: string, toYmd: string): number {
  const from = new Date(startOfWeek(fromYmd) + "T12:00:00Z").getTime();
  const to = new Date(startOfWeek(toYmd) + "T12:00:00Z").getTime();
  return Math.round((to - from) / (7 * 86_400_000)) + 1;
}

/**
 * Pick the bucket so the chart stays readable at any range a broker selects.
 *
 * The range is theirs to choose — this week through all time — so a FIXED
 * bucket is wrong at one end or the other. Monthly turns "this month" into a
 * single bar; weekly turned a year-to-date report into 34 of them, which on a
 * printed page is a picket fence rather than a trend.
 *
 * Thresholds are chosen to keep the bar count roughly in the 6–16 band, which
 * is where a trend is legible without a magnifier.
 */
export function pickVolumeBucket(weeks: number): VolumeBucket {
  if (weeks <= 12) return "weekly";
  if (weeks <= 32) return "biweekly";
  return "monthly";
}

/** First day of the bucket `pickupYmd` falls in, given the bucket and the anchor week. */
function bucketStart(pickupYmd: string, bucket: VolumeBucket, anchorWeek: string): string {
  if (bucket === "monthly") return pickupYmd.slice(0, 7) + "-01";
  const week = startOfWeek(pickupYmd);
  if (bucket === "weekly") return week;
  // Biweekly pairs are counted FORWARD from the first week in range, so the
  // bucket boundaries do not shift when the range does.
  const weeksIn = Math.round(
    (new Date(week + "T12:00:00Z").getTime() - new Date(anchorWeek + "T12:00:00Z").getTime()) /
      (7 * 86_400_000)
  );
  const pairIndex = Math.floor(weeksIn / 2) * 2;
  const start = new Date(anchorWeek + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() + pairIndex * 7);
  return start.toISOString().slice(0, 10);
}

/**
 * Load volume over time, bucketed to stay readable.
 *
 * Counts LOADS as the primary series — the question the customer is answering
 * is "is our freight with them growing", which is a volume question. Revenue
 * rides along on each point so the tooltip can show both without a second pass.
 */
export function buildVolumeTrend(loads: ReportLoad[]): VolumeTrend {
  if (loads.length === 0) return { bucket: "weekly", points: [] };

  const dates = loads.map((l) => l.pickupYmd).sort();
  const bucket = pickVolumeBucket(weeksSpanned(dates[0], dates[dates.length - 1]));
  const anchorWeek = startOfWeek(dates[0]);

  const byBucket = new Map<string, VolumePoint>();
  for (const l of loads) {
    const start = bucketStart(l.pickupYmd, bucket, anchorWeek);
    const entry = byBucket.get(start) ?? { start, revenue: 0, loads: 0 };
    entry.revenue += l.revenue;
    entry.loads++;
    byBucket.set(start, entry);
  }

  return {
    bucket,
    points: Array.from(byBucket.values())
      .map((p) => ({ ...p, revenue: round2(p.revenue) }))
      .sort((a, b) => a.start.localeCompare(b.start)),
  };
}

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

  const volume = buildVolumeTrend(loads);

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
    volume,
    topLanes,
    firstLoadDate: sorted.length > 0 ? sorted[0].pickupYmd : null,
    lastLoadDate: sorted.length > 0 ? sorted[sorted.length - 1].pickupYmd : null,
  };
}
