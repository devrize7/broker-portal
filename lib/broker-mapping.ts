/**
 * Broker Mapping Utility
 *
 * Maps all salesRep strings (including multi-rep entries) to one of the
 * 9 active brokers. Support staff and inactive reps are handled separately.
 */

const ACTIVE_BROKERS = [
  "Tom Licata",
  "James Davison",
  "Joe Corbett",
  "Drew Ivey",
  "Grant Morse",
  "Raphael Jackson",
  "David Gheran",
  "Ivan Moya",
  "Brian Pollock",
  "Alonzo Hunt",
] as const;

export type ActiveBroker = (typeof ACTIVE_BROKERS)[number];

const ACTIVE_SET = new Set<string>(ACTIVE_BROKERS);

/**
 * Sales contest exclusions.
 * Broker still owns the customer (kept on leaderboard, scorecard, broker
 * profit) but doesn't get sales contest credit. Use case: Ivan is the
 * account manager for Cleveland Kitchen (5% commission in TAI) but wasn't
 * the primary sales broker who brought the account in, so it shouldn't
 * count toward the contest.
 */
const SALES_CONTEST_EXCLUSIONS: Record<string, string[]> = {
  "Cleveland Kitchen": ["Ivan Moya"],
};

/**
 * Check if a broker+customer combo should be excluded from sales contest scoring.
 * Use in sales contest surfaces ONLY — leaderboard/scorecard/broker profit keep credit.
 */
export function isSalesContestExcluded(
  broker: string | null | undefined,
  customer: string | null | undefined
): boolean {
  if (!broker || !customer) return false;
  const excluded = SALES_CONTEST_EXCLUSIONS[customer];
  return excluded ? excluded.includes(broker) : false;
}

export interface BrokerResolution {
  broker: string;
  isActive: boolean;
}

/**
 * Given a salesRep string (possibly comma-separated), resolve to the
 * active broker. If multiple active brokers appear, the first one wins.
 * If no active broker is found, returns the original string with isActive=false.
 */
export function resolveActiveBroker(
  salesRep: string | null | undefined
): BrokerResolution {
  if (!salesRep || salesRep === "null" || salesRep.trim() === "") {
    return { broker: "Unassigned", isActive: false };
  }

  // Split by comma and trim
  const names = salesRep.split(",").map((n) => n.trim());

  // Find the first active broker in the list
  for (const name of names) {
    if (ACTIVE_SET.has(name)) {
      return { broker: name, isActive: true };
    }
  }

  // No active broker found — return first name as inactive
  return { broker: names[0], isActive: false };
}

/**
 * Get list of all active broker names
 */
export function getActiveBrokerNames(): string[] {
  return [...ACTIVE_BROKERS];
}

/**
 * Check if a broker name is active
 */
export function isBrokerActive(name: string): boolean {
  return ACTIVE_SET.has(name);
}

/**
 * Aggregate load data by resolved broker.
 * Takes raw loads with salesRep strings and groups them by active broker.
 */
export function aggregateByBroker<
  T extends { salesRep: string | null; [key: string]: unknown },
>(
  loads: T[]
): Map<string, { broker: string; isActive: boolean; loads: T[] }> {
  const map = new Map<
    string,
    { broker: string; isActive: boolean; loads: T[] }
  >();

  for (const load of loads) {
    const { broker, isActive } = resolveActiveBroker(load.salesRep);
    const existing = map.get(broker);
    if (existing) {
      existing.loads.push(load);
    } else {
      map.set(broker, { broker, isActive, loads: [load] });
    }
  }

  return map;
}
