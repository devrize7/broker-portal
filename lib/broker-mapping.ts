/**
 * Broker Mapping Utility
 *
 * Maps salesRep strings (including multi-rep entries) to an active broker.
 * The roster is no longer hardcoded here — it comes from the freight-dashboard
 * feed via lib/roster.ts (getRoster()). These functions are pure and take a
 * Roster snapshot first, so callers fetch the roster once per request and
 * thread it through. Mirrors freight-dashboard lib/broker-roster.ts.
 */

import type { Roster } from "@/lib/roster";

export interface BrokerResolution {
  broker: string;
  isActive: boolean;
}

/**
 * Given a salesRep string (possibly comma-separated), resolve to the
 * active broker. If multiple active brokers appear, the first one wins.
 * If no active broker is found, returns the first name with isActive=false.
 */
export function resolveActiveBroker(
  roster: Roster,
  salesRep: string | null | undefined
): BrokerResolution {
  if (!salesRep || salesRep === "null" || salesRep.trim() === "") {
    return { broker: "Unassigned", isActive: false };
  }
  const names = salesRep.split(",").map((n) => n.trim());
  for (const name of names) {
    if (roster.byName.get(name)?.active) {
      return { broker: name, isActive: true };
    }
  }
  return { broker: names[0], isActive: false };
}

/** Active broker names in displayOrder (nulls last). */
export function getActiveBrokerNames(roster: Roster): string[] {
  return [...roster.activeNames];
}

/** Whether a broker name is currently active. */
export function isBrokerActive(roster: Roster, name: string): boolean {
  return roster.byName.get(name)?.active === true;
}

/**
 * Sales contest exclusions.
 * Broker still owns the customer (kept on leaderboard, scorecard, broker
 * profit) but doesn't get sales contest credit. Use case: Ivan is the
 * account manager for Cleveland Kitchen (5% commission in TAI) but wasn't
 * the primary sales broker who brought the account in, so it shouldn't
 * count toward the contest. This is broker+customer config, not roster
 * data, so it stays hardcoded here (mirrors freight-dashboard).
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
