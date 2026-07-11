/**
 * TRUE MARGIN — netting lumper pass-through out of leaderboard numbers.
 *
 * MIRROR of freight-dashboard `lib/domain/margin.ts` — keep the two in sync.
 * A lumper (dock un/loading) fee is a reimbursement: Oath fronts it and bills
 * the customer back. TAI records it on the SELL side (in `revenue`) with the
 * payment landing buy=$0, so the whole lumper fell into margin as fake profit.
 * We net out the lumper's OWN contribution (sell − buy), which is a no-op once a
 * load is entered as a transit leg (buy=sell) — so it never double-counts.
 *
 * The lumperRevenue / lumperCost columns live on the shared Turso `Load` table
 * (added by the freight-dashboard migration). Select them and pass them here.
 */

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** The lumper's net margin contribution on a load (sell − buy). 0 ⇒ no impact. */
export function netLumper(lumperRevenue?: number | null, lumperCost?: number | null): number {
  return n(lumperRevenue) - n(lumperCost);
}

/** Gross margin (revenue − carrierCost) with the lumper pass-through netted out. */
export function trueMargin(
  revenue: number,
  carrierCost: number,
  lumperRevenue?: number | null,
  lumperCost?: number | null
): number {
  return revenue - carrierCost - netLumper(lumperRevenue, lumperCost);
}

/** Revenue with the lumper reimbursement removed (the margin-% base). */
export function trueRevenue(revenue: number, lumperRevenue?: number | null): number {
  return revenue - n(lumperRevenue);
}
