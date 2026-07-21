/**
 * Broker roster — fed by the freight-dashboard command center.
 *
 * The dashboard's BrokerProfile table is the single source of truth for the
 * roster (edited via Manage Brokers on /brokers — no code change, no deploy).
 * This module fetches its portal feed, GET /api/brokers/roster (Bearer
 * PORTAL_ROSTER_TOKEN), and replaces the four hardcoded mirrors this repo
 * used to carry: ACTIVE_BROKERS (broker-mapping), EMAIL_TO_BROKER (auth),
 * and the two BROKER_HIRE_DATES/NON_EXPERIENCED copies (leaderboard/history).
 *
 * Availability contract: a feed outage must NEVER blank the portal — no
 * broker may disappear from the leaderboard, lose login, or gain/lose a goal
 * because of a transient error. So:
 *   - last good feed result is cached module-level and served stale on failure
 *   - before any successful fetch, a baked-in SEED (the roster as of
 *     2026-07-03, when the mirrors were retired) is used
 *   - a feed response with zero active brokers is treated as an outage,
 *     not as "everyone left"
 * Freshness: refetch at most every 60s per warm lambda (30s retry after a
 * failure), blocking — the feed is a single indexed DB read on the dashboard.
 */

export interface RosterBroker {
  name: string;
  active: boolean;
  departedAt: string | null; // ISO
  hireDate: string | null; // YYYY-MM-DD
  email: string | null;
  rampWeeks: number; // 6 experienced / 12 non-experienced
  goalAdjustment: number; // e.g. Tom Licata -100
  displayOrder: number | null;
}

export interface Roster {
  brokers: RosterBroker[];
  /** Active broker names in displayOrder (nulls last) — the old ACTIVE_BROKERS. */
  activeNames: string[];
  byName: Map<string, RosterBroker>;
  /** lowercased email → broker name, ACTIVE brokers only (login parity with
   * the old EMAIL_TO_BROKER: deactivating a broker disables their login). */
  emailToBroker: Map<string, string>;
}

// ── Baked-in seed: the roster on mirror-retirement day (2026-07-03) ─────────
// Fallback ONLY — the live roster is the dashboard's BrokerProfile table.
// Do not update this when the roster changes; edits happen in Manage Brokers.
const seedBroker = (
  name: string,
  hireDate: string | null,
  email: string | null,
  rampWeeks: 6 | 12,
  displayOrder: number | null,
  opts: { goalAdjustment?: number; active?: boolean; departedAt?: string | null } = {}
): RosterBroker => ({
  name,
  active: opts.active ?? true,
  departedAt: opts.departedAt ?? null,
  hireDate,
  email,
  rampWeeks,
  goalAdjustment: opts.goalAdjustment ?? 0,
  displayOrder,
});

export const SEED_BROKERS: RosterBroker[] = [
  seedBroker("Tom Licata", "2025-08-18", "tom.licata@gowithoath.com", 6, 0, { goalAdjustment: -100 }),
  seedBroker("James Davison", "2025-09-29", "james.davison@gowithoath.com", 6, 1),
  seedBroker("Drew Ivey", "2025-06-02", "drew.ivey@gowithoath.com", 6, 2),
  seedBroker("Grant Morse", "2026-01-05", "grant.morse@gowithoath.com", 6, 3),
  seedBroker("Raphael Jackson", "2026-01-19", "raphael.jackson@gowithoath.com", 6, 4),
  seedBroker("David Gheran", "2026-01-19", "david.gheran@gowithoath.com", 12, 5),
  seedBroker("Ivan Moya", "2026-01-19", "ivan.moya@gowithoath.com", 12, 6),
  seedBroker("Alonzo Hunt", "2026-03-23", "alonzo.hunt@gowithoath.com", 6, 7),
  seedBroker("Reggie Pena", "2026-05-04", "reggie.pena@gowithoath.com", 12, 8),
  seedBroker("Eric Hedgmon", "2026-05-04", "eric.hedgmon@gowithoath.com", 12, 9),
  seedBroker("Brett Olgin", "2026-06-15", "brett.olgin@gowithoath.com", 6, 10),
  // Inactive (login disabled, loads kept) — removed from active 2026-07-03.
  seedBroker("Joe Corbett", "2025-03-31", "jcorbett@gowithoath.com", 6, null, { active: false }),
  // Departed (dates approximate — the set membership is what matters here).
  seedBroker("Brian Pollock", null, null, 6, null, { active: false, departedAt: "2026-05-01" }),
  seedBroker("Chase Long", null, null, 6, null, { active: false, departedAt: "2026-06-01" }),
];

/** Build the derived lookups from a broker list. Throws if no one is active —
 * callers treat that as an outage and keep the previous roster/seed. */
export function buildRoster(brokers: RosterBroker[]): Roster {
  const activeNames = brokers
    .filter((b) => b.active)
    .sort(
      (a, b) =>
        (a.displayOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.displayOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name)
    )
    .map((b) => b.name);
  if (activeNames.length === 0) {
    throw new Error("Roster has zero active brokers — refusing to use it");
  }
  const byName = new Map(brokers.map((b) => [b.name, b]));
  const emailToBroker = new Map<string, string>();
  for (const b of brokers) {
    if (b.active && b.email) emailToBroker.set(b.email.trim().toLowerCase(), b.name);
  }
  return { brokers, activeNames, byName, emailToBroker };
}

/** Parse one feed row defensively; returns null for malformed rows. */
export function parseFeedBroker(raw: unknown): RosterBroker | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.trim() === "") return null;
  if (typeof r.active !== "boolean") return null;
  const name = r.name;
  // Older feed deploys omit goalAdjustment — fall back to the seed's value
  // for that broker (never silently zero Tom's -100).
  const seedAdj = SEED_BROKERS.find((s) => s.name === name)?.goalAdjustment ?? 0;
  return {
    name,
    active: r.active,
    departedAt: typeof r.departedAt === "string" ? r.departedAt : null,
    hireDate: typeof r.hireDate === "string" ? r.hireDate.slice(0, 10) : null,
    email: typeof r.email === "string" ? r.email : null,
    rampWeeks: typeof r.rampWeeks === "number" ? r.rampWeeks : 6,
    goalAdjustment: typeof r.goalAdjustment === "number" ? r.goalAdjustment : seedAdj,
    displayOrder: typeof r.displayOrder === "number" ? r.displayOrder : null,
  };
}

// ── Fetch + cache ────────────────────────────────────────────────────────────

const FEED_URL =
  process.env.ROSTER_FEED_URL ||
  "https://freight-dashboard-orcin.vercel.app/api/brokers/roster";
const TTL_MS = 60_000; // re-probe interval after a good fetch
const RETRY_MS = 30_000; // re-probe interval after a failed fetch
const FETCH_TIMEOUT_MS = 5_000;
// A healthy feed drops NO rows (our own dashboard emits uniform records), so a
// dropped row means schema drift and the WHOLE payload is suspect. Reject when
// more than this fraction fails to parse — a partial roster served as complete
// would silently blank brokers (lost leaderboard rows + logins), the exact
// failure this module exists to prevent. One freak row is tolerated so a single
// oddity can't wedge every future update onto stale data.
const MAX_PARSE_DROP_FRACTION = 0.1;

let cached: Roster | null = null;
let lastAttempt = 0;
let lastAttemptOk = false;

async function fetchFeed(): Promise<Roster> {
  const token = process.env.PORTAL_ROSTER_TOKEN;
  if (!token) throw new Error("PORTAL_ROSTER_TOKEN not set");
  const res = await fetch(FEED_URL, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Roster feed HTTP ${res.status}`);
  const json = (await res.json()) as { brokers?: unknown };
  if (!Array.isArray(json.brokers)) throw new Error("Roster feed: no brokers array");
  const received = json.brokers.length;
  const brokers = json.brokers
    .map(parseFeedBroker)
    .filter((b): b is RosterBroker => b !== null);
  const dropped = received - brokers.length;
  if (received > 0 && dropped / received > MAX_PARSE_DROP_FRACTION) {
    // Don't serve a partial roster as authoritative — bail to cache/seed.
    throw new Error(
      `Roster feed: ${dropped}/${received} rows failed to parse (schema drift?) — rejecting payload`
    );
  }
  return buildRoster(brokers); // throws on zero active — treated as outage
}

/**
 * Get the current roster. Never rejects: on any feed problem it returns the
 * last good roster, or the baked-in seed if there has never been one. After a
 * failure it re-probes every RETRY_MS (not TTL_MS), whether it's serving a
 * stale-but-good feed roster or the seed.
 */
export async function getRoster(): Promise<Roster> {
  const now = Date.now();
  const window = lastAttemptOk ? TTL_MS : RETRY_MS;
  if (cached && now - lastAttempt < window) return cached;
  lastAttempt = now;
  try {
    cached = await fetchFeed();
    lastAttemptOk = true;
  } catch (e) {
    lastAttemptOk = false;
    console.error(
      cached
        ? "Roster feed unavailable — serving previous roster:"
        : "Roster feed unavailable — serving baked-in seed roster:",
      e
    );
    if (!cached) cached = buildRoster(SEED_BROKERS);
  }
  return cached;
}

/** Test hook — reset the module cache. */
export function _resetRosterCache(): void {
  cached = null;
  lastAttempt = 0;
  lastAttemptOk = false;
}

// ── Weekly goal (mirrors freight-dashboard lib/broker-roster.ts weeklyGoal) ─
/**
 * totalWeeks = floor((weekMonday − hireDate) / 7d); $0 while ramping
 * (rampWeeks: 6 experienced / 12 non-experienced); else
 * max(0, (totalWeeks − rampWeeks + 2) × $100 + goalAdjustment).
 * hireDate "YYYY-MM-DD" parses to UTC midnight — identical instant to the
 * old hardcoded constants, so goal math is unchanged.
 */
export function getWeeklyGoal(roster: Roster, broker: string, weekMonday: Date): number {
  const b = roster.byName.get(broker);
  if (!b?.hireDate) return 0;
  const { weeksIn, rampWeeks, ramping } = getRampStatus(roster, broker, weekMonday);
  if (ramping) return 0;
  const weeksOnGoal = weeksIn - rampWeeks + 2;
  return Math.max(0, weeksOnGoal * 100 + b.goalAdjustment);
}

/**
 * How far into their ramp a broker is for the given week. `ramping` means the
 * broker has no goal YET — distinct from a $0 goal they failed to earn, which
 * matters when a leaderboard row has to explain an empty goal bar. Shares
 * getWeeklyGoal's weeks-since-hire math so the two can never disagree.
 * No/invalid hire date (or unknown broker) ⇒ not ramping — matches
 * getWeeklyGoal's "return 0" bail-outs.
 */
export function getRampStatus(
  roster: Roster,
  broker: string,
  weekMonday: Date
): { weeksIn: number; rampWeeks: number; ramping: boolean } {
  const b = roster.byName.get(broker);
  const rampWeeks = b?.rampWeeks ?? 0;
  if (!b?.hireDate) return { weeksIn: 0, rampWeeks, ramping: false };
  const hireDate = new Date(b.hireDate);
  if (isNaN(hireDate.getTime())) return { weeksIn: 0, rampWeeks, ramping: false };
  const weeksIn = Math.floor(
    (weekMonday.getTime() - hireDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  return { weeksIn, rampWeeks, ramping: weeksIn < rampWeeks };
}
