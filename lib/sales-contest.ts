/**
 * 2026 Finish Strong Sales Championship — scoring rules.
 *
 * Aug 3 – Dec 18, 2026. Brokers are ranked by gross margin earned from NEW
 * customers (accounts that had never shipped with Oath before kickoff). Three
 * side awards ride on the same data: most new customers landed, the single
 * highest-margin new account, and whoever leads at the midpoint.
 *
 * Everything here is pure so the standings can be unit-tested without a DB.
 * The route (app/api/sales-contest/route.ts) owns the queries and the
 * revenue/margin normalization; this module owns the contest rules.
 *
 * Two rules on the flyer are deliberately NOT computed here:
 *   - "Clean files required" — no file-quality signal exists in TAI or the
 *     dashboard, so it is management's call at the end.
 *   - "Must exceed individual sales goal to qualify" — a broker's weekly goal
 *     is known, but "exceeded it" over a 19-week contest has no single
 *     reading (every week? a majority? cumulative?). Ranking everyone and
 *     printing the rule is honest; guessing a reading would mean the board
 *     shows the wrong leader. Both are rendered as contest rules on the card.
 */

/** First day of the contest (inclusive). */
export const CONTEST_START = "2026-08-03";
/** Final day of the contest (inclusive) — for display. */
export const CONTEST_END = "2026-12-18";
/**
 * The end bound is enforced, not assumed. The previous contest kept accruing
 * after-the-bell loads until this was added (portal #13) — five brokers had
 * already gained $25–$650 of post-contest margin with the #1/#2 gap at ~$575.
 */
export const CONTEST_END_EXCLUSIVE = "2026-12-19";

/**
 * Midpoint Leader award cutoff: Sun Oct 11, 2026 — day 69 of the contest's
 * 138, and the end of contest week 10, so it lands on a whole week boundary
 * like the weekly leaderboard updates the flyer promises.
 */
export const CONTEST_MIDPOINT = "2026-10-11";
export const CONTEST_MIDPOINT_EXCLUSIVE = "2026-10-12";

/**
 * A contest-countable load, already resolved to an active broker.
 *
 * `pickupYmd` is the America/New_York calendar date (from `etYmd`), not a raw
 * timestamp: a pickup stamped 02:00 UTC is the previous evening in New York,
 * and on the Dec 18 boundary that is the difference between counting and not.
 */
export interface ContestLoad {
  broker: string;
  customer: string;
  /** Gross margin, lumper pass-through already netted out. */
  gp: number;
  revenue: number;
  pickupYmd: string;
}

export interface ContestCustomer {
  customer: string;
  loads: number;
  gp: number;
  revenue: number;
  /** ET calendar date of the account's first contest load. */
  firstPickup: string;
}

/** Whether an ET pickup date falls inside the contest window. */
export function inContestWindow(pickupYmd: string): boolean {
  return pickupYmd >= CONTEST_START && pickupYmd < CONTEST_END_EXCLUSIVE;
}

export interface ContestBroker {
  broker: string;
  customers: ContestCustomer[];
  totalGP: number;
  totalLoads: number;
  totalRevenue: number;
  newCustomerCount: number;
}

/** Ties are real — every tied broker is named rather than picking one. */
export interface MostNewCustomersAward {
  brokers: string[];
  count: number;
}

export interface TopNewCustomerAward {
  entries: Array<{ broker: string; customer: string }>;
  gp: number;
}

export interface MidpointAward {
  brokers: string[];
  gp: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Group contest loads into per-broker standings, ranked by total gross margin.
 *
 * Every active broker appears, including those with no new customers yet —
 * they render as real zeros below the producers rather than being dropped
 * (same rule as the leaderboard).
 */
export function rankBrokers(
  loads: ContestLoad[],
  activeBrokers: string[] = []
): ContestBroker[] {
  const byBroker = new Map<string, Map<string, ContestCustomer>>();

  for (const load of loads) {
    if (!load.broker || !load.customer) continue;
    let customers = byBroker.get(load.broker);
    if (!customers) {
      customers = new Map();
      byBroker.set(load.broker, customers);
    }
    const entry = customers.get(load.customer) ?? {
      customer: load.customer,
      loads: 0,
      gp: 0,
      revenue: 0,
      firstPickup: load.pickupYmd,
    };
    entry.loads++;
    entry.gp += load.gp;
    entry.revenue += load.revenue;
    if (load.pickupYmd < entry.firstPickup) entry.firstPickup = load.pickupYmd;
    customers.set(load.customer, entry);
  }

  const brokers: ContestBroker[] = Array.from(byBroker.entries()).map(
    ([broker, customers]) => {
      const list = Array.from(customers.values())
        .map((c) => ({ ...c, gp: round2(c.gp), revenue: round2(c.revenue) }))
        .sort((a, b) => b.gp - a.gp);
      return {
        broker,
        customers: list,
        totalGP: round2(list.reduce((s, c) => s + c.gp, 0)),
        totalLoads: list.reduce((s, c) => s + c.loads, 0),
        totalRevenue: round2(list.reduce((s, c) => s + c.revenue, 0)),
        newCustomerCount: list.length,
      };
    }
  );

  for (const name of activeBrokers) {
    if (!brokers.some((b) => b.broker === name)) {
      brokers.push({
        broker: name,
        customers: [],
        totalGP: 0,
        totalLoads: 0,
        totalRevenue: 0,
        newCustomerCount: 0,
      });
    }
  }

  return brokers.sort((a, b) => b.totalGP - a.totalGP);
}

/**
 * "Most New Customers — YETI Package". Null until somebody has landed one, so
 * the card never announces a leader over a field of zeros.
 */
export function mostNewCustomers(
  standings: ContestBroker[]
): MostNewCustomersAward | null {
  const count = Math.max(0, ...standings.map((b) => b.newCustomerCount));
  if (count === 0) return null;
  return {
    brokers: standings
      .filter((b) => b.newCustomerCount === count)
      .map((b) => b.broker),
    count,
  };
}

/**
 * "Highest Margin New Customer — Premium OATH Gear": the single best account,
 * not the best broker. Requires positive margin — a field of losses has no
 * winner.
 */
export function topNewCustomer(
  standings: ContestBroker[]
): TopNewCustomerAward | null {
  let best = 0;
  for (const b of standings) {
    for (const c of b.customers) if (c.gp > best) best = c.gp;
  }
  if (best <= 0) return null;
  const entries: Array<{ broker: string; customer: string }> = [];
  for (const b of standings) {
    for (const c of b.customers) {
      if (c.gp === best) entries.push({ broker: b.broker, customer: c.customer });
    }
  }
  return { entries, gp: best };
}

/** Loads that count toward the Midpoint Leader award (pickup on or before Oct 11). */
export function midpointLoads(loads: ContestLoad[]): ContestLoad[] {
  return loads.filter((l) => l.pickupYmd < CONTEST_MIDPOINT_EXCLUSIVE);
}

/** Whether the midpoint has passed, given today as YYYY-MM-DD. */
export function midpointReached(today: string): boolean {
  return today >= CONTEST_MIDPOINT_EXCLUSIVE;
}

/**
 * "Midpoint Leader — Dinner & Hotel Experience". Only meaningful once the
 * midpoint is behind us; before that the route does not ask for it, so the
 * card shows the award as still up for grabs rather than crowning whoever
 * happens to lead in week 2.
 */
export function midpointLeader(loads: ContestLoad[]): MidpointAward | null {
  const standings = rankBrokers(midpointLoads(loads));
  const gp = Math.max(0, ...standings.map((b) => b.totalGP));
  if (gp <= 0) return null;
  return {
    brokers: standings.filter((b) => b.totalGP === gp).map((b) => b.broker),
    gp,
  };
}
