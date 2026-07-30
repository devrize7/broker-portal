/**
 * A broker's BOOK OF BUSINESS — the customers behind their loads, split into
 * the ones they're currently running and the ones that have gone quiet.
 *
 * ── What "inactive" can and cannot mean here ────────────────────────────────
 * There is no broker↔customer relationship stored anywhere in this system.
 * `Load.customer` is a plain string and the `Customer` table has no rep column,
 * so the ONLY link between a broker and a customer is a load they ran. That
 * means:
 *
 *   dormant  = ran loads before, none in the last DORMANT_DAYS   ← computable
 *   prospect = a customer they own but have never run            ← NOT knowable
 *
 * The dormant list is the "customers we aren't currently running with"
 * conversation. A prospect list would need a CRM link that doesn't exist; do not
 * let a future caller quietly reinterpret `dormant` as "the whole book".
 *
 * ── Why status is independent of the selected date range ────────────────────
 * Active/dormant describes the RELATIONSHIP and is always measured against
 * today (a fixed DORMANT_DAYS lookback). The caller's date range only controls
 * the NUMBERS shown per customer. Deriving status from the range instead would
 * mean picking "Last week" marks nearly the whole book inactive, which is both
 * wrong and useless in a 1:1. The useful reading is the opposite: "you have 11
 * active accounts and only 3 of them ran last week."
 *
 * Pure and side-effect free — every input is passed in, including `today`, so
 * the split is deterministic and testable.
 */

/**
 * No load in this many days ⇒ dormant. 60 days per Jacob (2026-07-29): tight
 * enough to flag slippage while a customer is still winnable, rather than
 * confirming a loss a quarter later.
 */
export const DORMANT_DAYS = 60;

export interface BookLoadRow {
  customer: string;
  /** Calendar date, `YYYY-MM-DD` (pickupDate sliced — see lib/date-ranges.ts). */
  pickupDate: string;
  revenue: number;
  carrierCost: number;
  lumperRevenue: number;
  lumperCost: number;
}

export interface BookStats {
  loads: number;
  revenue: number;
  margin: number;
}

export interface CustomerBookEntry {
  customer: string;
  status: "active" | "dormant";
  /** Most recent pickup date across the customer's whole history with this broker. */
  lastLoadDate: string;
  /**
   * Days since that load. Clamped at 0 — countable loads with future pickup
   * dates genuinely exist in the book (12 at time of writing), and a negative
   * "days since" would both read as nonsense and sort wrong.
   */
  daysSinceLastLoad: number;
  /** Totals across the broker's entire history with this customer. */
  lifetime: BookStats;
  /** Totals within the caller's selected date range. */
  period: BookStats;
}

export interface CustomerBook {
  active: CustomerBookEntry[];
  dormant: CustomerBookEntry[];
  /** Sum of every customer's `period` stats — the range totals for the header. */
  periodTotals: BookStats;
  dormantDays: number;
}

/**
 * True margin nets out the lumper pass-through. A lumper fee is a
 * REIMBURSEMENT: Oath fronts it and bills the customer back, but the ComChek
 * payment lands buy=$0, so the whole fee would otherwise read as profit. Same
 * rule as lib/margin.ts — kept in sync deliberately.
 */
function trueMargin(row: BookLoadRow): number {
  return row.revenue - row.carrierCost - (row.lumperRevenue - row.lumperCost);
}

function trueRevenue(row: BookLoadRow): number {
  return row.revenue - row.lumperRevenue;
}

function emptyStats(): BookStats {
  return { loads: 0, revenue: 0, margin: 0 };
}

function accumulate(into: BookStats, row: BookLoadRow): void {
  into.loads += 1;
  into.revenue += trueRevenue(row);
  into.margin += trueMargin(row);
}

/**
 * Build the split book.
 *
 * `rows` must be the broker's ENTIRE countable history (not just the selected
 * range) — dormancy and lifetime totals are meaningless on a windowed set, and
 * a customer with no loads in the range would vanish from the book entirely,
 * which is exactly the customer the meeting is about.
 */
export function buildCustomerBook(
  rows: BookLoadRow[],
  opts: {
    today: string;
    rangeFrom: string;
    /** EXCLUSIVE upper bound. */
    rangeToExclusive: string;
    dormantDays?: number;
  }
): CustomerBook {
  const dormantDays = opts.dormantDays ?? DORMANT_DAYS;

  const byCustomer = new Map<
    string,
    { lastLoadDate: string; lifetime: BookStats; period: BookStats }
  >();

  for (const row of rows) {
    const name = row.customer?.trim();
    if (!name) continue;

    let entry = byCustomer.get(name);
    if (!entry) {
      entry = { lastLoadDate: row.pickupDate, lifetime: emptyStats(), period: emptyStats() };
      byCustomer.set(name, entry);
    }

    accumulate(entry.lifetime, row);
    if (row.pickupDate > entry.lastLoadDate) entry.lastLoadDate = row.pickupDate;
    if (row.pickupDate >= opts.rangeFrom && row.pickupDate < opts.rangeToExclusive) {
      accumulate(entry.period, row);
    }
  }

  const active: CustomerBookEntry[] = [];
  const dormant: CustomerBookEntry[] = [];
  const periodTotals = emptyStats();

  for (const [customer, entry] of byCustomer) {
    const rawDays = daysSince(entry.lastLoadDate, opts.today);
    const daysSinceLastLoad = Math.max(0, rawDays);
    const built: CustomerBookEntry = {
      customer,
      status: daysSinceLastLoad <= dormantDays ? "active" : "dormant",
      lastLoadDate: entry.lastLoadDate,
      daysSinceLastLoad,
      lifetime: entry.lifetime,
      period: entry.period,
    };

    periodTotals.loads += entry.period.loads;
    periodTotals.revenue += entry.period.revenue;
    periodTotals.margin += entry.period.margin;

    (built.status === "active" ? active : dormant).push(built);
  }

  // Active: biggest earner in the selected period first, falling back to
  // lifetime so a customer with a quiet period still ranks by real weight.
  active.sort(
    (a, b) => b.period.margin - a.period.margin || b.lifetime.margin - a.lifetime.margin
  );
  // Dormant: most RECENTLY lapsed first. Those are the winnable ones — a
  // customer that went quiet three weeks ago is a live conversation, one that
  // left 400 days ago is history.
  dormant.sort(
    (a, b) => a.daysSinceLastLoad - b.daysSinceLastLoad || b.lifetime.margin - a.lifetime.margin
  );

  return { active, dormant, periodTotals, dormantDays };
}

function daysSince(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
