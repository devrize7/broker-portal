import { NextResponse } from "next/server";
import { requireSession } from "@/lib/route-auth";
import { db } from "@/lib/db";
import { resolveActiveBroker, getActiveBrokerNames, isSalesContestExcluded } from "@/lib/broker-mapping";
import { getRoster } from "@/lib/roster";
import { EXCLUDED_STATUSES, etYmd, fetchCountableLoads } from "@/lib/load-query";
import { trueMargin, trueRevenue } from "@/lib/margin";
import {
  CONTEST_START,
  CONTEST_END,
  CONTEST_MIDPOINT,
  inContestWindow,
  midpointLeader,
  midpointReached,
  mostNewCustomers,
  rankBrokers,
  topNewCustomer,
  type ContestLoad,
} from "@/lib/sales-contest";

export const dynamic = "force-dynamic";

/**
 * Every customer that had already SHIPPED before kickoff — the contest's
 * "new customer" test is the complement of this set.
 *
 * Deliberately its own query rather than a slice of fetchCountableLoads():
 * this answers "have they ever shipped with us", not "how much did we make",
 * so the profitability-CSV week rule (which drops untagged loads inside a
 * CSV-covered week to avoid double-counting revenue) must not apply — it
 * could drop a customer's only historical load and make a long-standing
 * account read as brand new.
 *
 * The status filter DOES apply: an account we only ever quoted or that
 * cancelled has never been a customer, so landing them now is a genuinely new
 * account. Measured before shipping — 5 such accounts exist pre-kickoff
 * (incl. "Oath Logistics Test Customer") and none have shipped in the contest
 * window, so this is behaviour-neutral today and correct going forward.
 */
async function fetchExistingCustomers(): Promise<Set<string>> {
  const placeholders = EXCLUDED_STATUSES.map(() => "?").join(",");
  const result = await db.execute({
    sql: `SELECT customer, MIN(pickupDate) firstPickup FROM Load
          WHERE customer IS NOT NULL AND pickupDate IS NOT NULL
            AND status NOT IN (${placeholders})
          GROUP BY customer`,
    args: [...EXCLUDED_STATUSES],
  });

  const existing = new Set<string>();
  for (const row of result.rows) {
    // ET-dated for the same reason the contest window is: a load stamped
    // 02:00 UTC on kickoff day is the evening BEFORE in New York. Timestamps
    // are UTC in both stored spellings ("…Z" and "…+00:00"), so MIN() is the
    // genuine earliest instant and its ET date is the earliest ET date.
    if (etYmd(String(row.firstPickup)) < CONTEST_START) {
      existing.add(String(row.customer));
    }
  }
  return existing;
}

export async function GET() {
  const { session, response } = await requireSession();
  if (!session) return response;

  try {
    const roster = await getRoster();
    const activeBrokers = getActiveBrokerNames(roster);

    const [allLoads, existingCustomers] = await Promise.all([
      fetchCountableLoads(),
      fetchExistingCustomers(),
    ]);

    const contestLoads: ContestLoad[] = [];
    for (const load of allLoads) {
      if (!inContestWindow(load.pickupYmd)) continue;
      if (!load.customer || !load.salesRep) continue;
      if (existingCustomers.has(load.customer)) continue;

      const { broker, isActive } = resolveActiveBroker(roster, load.salesRep);
      if (!isActive) continue;
      // Account-manager-only credit (e.g. Ivan/Cleveland Kitchen) — broker keeps
      // leaderboard/profit credit but doesn't earn sales contest standing.
      if (isSalesContestExcluded(broker, load.customer)) continue;

      contestLoads.push({
        broker,
        customer: load.customer,
        // Lumper pass-through netted out (see lib/margin.ts).
        gp: trueMargin(load.revenue, load.carrierCost, load.lumperRevenue, load.lumperCost),
        revenue: trueRevenue(load.revenue, load.lumperRevenue),
        pickupYmd: load.pickupYmd,
      });
    }

    const brokers = rankBrokers(contestLoads, activeBrokers);
    const today = etYmd(new Date().toISOString());

    return NextResponse.json({
      brokers,
      contestStart: CONTEST_START,
      contestEnd: CONTEST_END,
      contestOver: today > CONTEST_END,
      awards: {
        mostNewCustomers: mostNewCustomers(brokers),
        topNewCustomer: topNewCustomer(brokers),
        // Before the midpoint this stays null and the card shows the award as
        // still up for grabs — crowning a "midpoint leader" in week 2 would be
        // announcing a winner of a race that is not half run.
        midpointLeader: midpointReached(today) ? midpointLeader(contestLoads) : null,
        midpointDate: CONTEST_MIDPOINT,
        midpointReached: midpointReached(today),
      },
    });
  } catch (err) {
    console.error("Sales contest error:", err);
    return NextResponse.json({ error: "Failed to load sales contest" }, { status: 500 });
  }
}
