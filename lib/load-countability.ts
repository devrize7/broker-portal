/**
 * Load countability — which loads carry real financials.
 *
 * CROSS-REPO MIRROR of freight-dashboard `lib/domain/load-countability.ts`
 * (`isRealLoad`). Change both together, or the portal leaderboard and the
 * command-center leaderboard will quote different margins for the same broker
 * in the same week — they read the same Turso `Load` table, so a rule that
 * lives in only one repo is a guaranteed disagreement.
 *
 * The dispatched-and-later status rule lives in `lib/load-query.ts`
 * (EXCLUDED_STATUSES); it is deliberately NOT duplicated here.
 */

export interface RealLoadLike {
  revenue: number;
  carrierCost: number;
  /**
   * Required on purpose. If it were optional, a caller that forgot to SELECT
   * the column would hand us `undefined` and every $0-cost load would silently
   * drop out of the leaderboard — invisible over-exclusion. Required makes that
   * a compile error instead.
   */
  carrier: string | null;
}

/**
 * True when a load carries real financials and should count toward a margin
 * figure. THREE rules, all about margin that isn't real:
 *
 * 1. PHANTOM ($0 revenue AND $0 cost) — a webhook status update that arrived
 *    with no financial data. The long-standing rule.
 *
 * 2. NEGATIVE COST — a buy side below $0 is a bad entry, and it inflates
 *    margin harder than a missing one (revenue − (−100) = revenue + 100).
 *    One such load exists: 125030207, carrierCost −$100, margin $488.70 on
 *    $388.70 of revenue.
 *
 * 3. NO CARRIER BOOKED ($0 cost and no carrier assigned) — the same reasoning
 *    that puts 'ready' in EXCLUDED_STATUSES, applied to loads whose STATUS
 *    moved on while the carrier was never entered. TAI reports them
 *    `Delivered` with `totalBuy: 0` and an empty carrierList, so the whole
 *    sell price books as margin: load 130982546 (DiMare Fresh, pickup
 *    2026-08-14) read as $2,915 of profit on one load — 39% of Raphael
 *    Jackson's week. Nobody hauls a load for free; the record is incomplete.
 *
 * A $0-cost load WITH a named carrier still counts. Those are accessorial
 * re-bills ($150–$250 detention-style charges against a named carrier) where
 * the margin is genuinely ours — 5 loads / $850 over three months. Jacob's
 * call, 2026-08-16: "the accessorials are fine ... it's more about the
 * linehaul". Over-excluding real margin is the harder error to notice, so the
 * test is deliberately narrower than a blanket `carrierCost > 0`.
 *
 * Self-healing: the moment the buy side is keyed into TAI, the load re-enters
 * the leaderboard on the next request. Nothing is persisted or backfilled.
 *
 * Lumper pass-through is a DIFFERENT inflation with its own fix — see
 * `trueMargin` in lib/margin.ts. Both apply.
 */
export function isRealLoad(load: RealLoadLike): boolean {
  if (load.revenue === 0 && load.carrierCost === 0) return false;
  if (load.carrierCost < 0) return false;
  if (load.carrierCost === 0 && !load.carrier?.trim()) return false;
  return true;
}
