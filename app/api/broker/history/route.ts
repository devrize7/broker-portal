import { NextRequest, NextResponse } from "next/server";
import { requireBrokerAccess } from "@/lib/route-auth";
import { getRoster, getWeeklyGoal } from "@/lib/roster";
import {
  fetchCountableLoads,
  fetchOpenArRows,
  loadsForBroker,
  type CountableLoad,
} from "@/lib/load-query";
import { buildCustomerBook, DORMANT_DAYS } from "@/lib/customer-book";
import { buildCustomerAr, isSeriouslyPastDue, type CustomerAr } from "@/lib/customer-ar";
import { parsePreset, resolveRange, startOfWeek, todayET } from "@/lib/date-ranges";

export const dynamic = "force-dynamic";

/**
 * A broker's drill-down: weekly trend, book of business, and period stats.
 *
 * Two independent time controls, deliberately:
 *   `weeks`            → the weekly TREND charts (a trailing window; a trend
 *                        needs a run of weeks, so it can't follow a range that
 *                        may be a single week).
 *   `preset`/`from`/`to` → the PERIOD pull: KPI totals, customer numbers, lanes
 *                        and carriers. This is the "what did they do last week /
 *                        last month / last quarter" control.
 *
 * Active vs dormant customer status does NOT follow the range — see the header
 * of lib/customer-book.ts for why.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const access = await requireBrokerAccess(params.get("broker"));
  if (!access.ok) return access.response;
  const broker = access.broker;

  const weeks = Math.min(Math.max(parseInt(params.get("weeks") ?? "12", 10) || 12, 1), 52);
  const range = resolveRange(parsePreset(params.get("preset")), {
    from: params.get("from"),
    to: params.get("to"),
  });
  const today = todayET();

  try {
    const [roster, allLoads, arRows] = await Promise.all([
      getRoster(),
      fetchCountableLoads(),
      fetchOpenArRows(),
    ]);
    const loads = loadsForBroker(allLoads, roster, broker);
    const arByCustomer = buildCustomerAr(arRows, Date.now());

    /**
     * Attach what the customer OWES to a book entry.
     *
     * These are the CUSTOMER's whole balance, not this broker's slice — that is
     * what reconciles with the Collections page, and it is the number that
     * should inform whether to book another load. Advisory only: the portal
     * shows it and offers no way to act on it (chasing belongs to the
     * collectors, whose dunning cadence a broker cannot see).
     */
    const withAr = <T extends { customer: string }>(entry: T) => {
      const ar: CustomerAr | undefined = arByCustomer.get(entry.customer);
      return {
        ...entry,
        ar: ar
          ? {
              totalOpen: ar.totalOpen,
              overdueTotal: ar.overdueTotal,
              oldestDaysOverdue: ar.oldestDaysOverdue,
              seriouslyPastDue: isSeriouslyPastDue(ar),
            }
          : null,
      };
    };

    // ── Weekly trend (trailing `weeks` window, independent of the range) ──────
    const thisWeekKey = startOfWeek(today);
    const windowStart = shiftWeeks(thisWeekKey, -(weeks - 1));

    const weekMap = new Map<string, { loads: number; revenue: number; margin: number }>();
    for (const load of loads) {
      if (load.weekKey < windowStart) continue;
      const bucket = weekMap.get(load.weekKey) ?? { loads: 0, revenue: 0, margin: 0 };
      bucket.loads += 1;
      bucket.revenue += trueRevenue(load);
      bucket.margin += trueMargin(load);
      weekMap.set(load.weekKey, bucket);
    }

    const weeklyData = [...weekMap.entries()]
      .map(([weekKey, data]) => ({
        weekKey,
        weekLabel: labelDay(weekKey),
        loads: data.loads,
        revenue: data.revenue,
        margin: data.margin,
        // getWeeklyGoal takes a week-END date and re-derives the Monday in ET.
        // Handing it a local-midnight Monday reads as Sunday 8pm ET on Vercel
        // and walks the derivation back a week, making every goal $100 light.
        // Noon on the Sunday is unambiguous under every US offset.
        goal: getWeeklyGoal(roster, broker, sundayNoon(weekKey)),
        isCurrent: weekKey === thisWeekKey,
      }))
      .sort((a, b) => a.weekKey.localeCompare(b.weekKey));

    // ── All-time record week (completed weeks only) ───────────────────────────
    const allWeeks = new Map<string, { margin: number; loads: number }>();
    for (const load of loads) {
      const bucket = allWeeks.get(load.weekKey) ?? { margin: 0, loads: 0 };
      bucket.margin += trueMargin(load);
      bucket.loads += 1;
      allWeeks.set(load.weekKey, bucket);
    }
    let recordWeek: { weekKey: string; weekLabel: string; margin: number; loads: number } | null =
      null;
    for (const [weekKey, d] of allWeeks) {
      if (weekKey === thisWeekKey) continue; // a partial week can't be a record
      if (!recordWeek || d.margin > recordWeek.margin) {
        recordWeek = { weekKey, weekLabel: labelDay(weekKey, true), margin: d.margin, loads: d.loads };
      }
    }

    // ── Book of business + period stats ───────────────────────────────────────
    const book = buildCustomerBook(
      loads.map((l) => ({
        customer: l.customer,
        pickupDate: l.pickupYmd,
        revenue: l.revenue,
        carrierCost: l.carrierCost,
        lumperRevenue: l.lumperRevenue,
        lumperCost: l.lumperCost,
      })),
      { today, rangeFrom: range.from, rangeToExclusive: range.toExclusive }
    );

    const inRange = loads.filter(
      (l) => l.pickupYmd >= range.from && l.pickupYmd < range.toExclusive
    );

    return NextResponse.json({
      broker,
      range: {
        preset: range.preset,
        label: range.label,
        from: range.from,
        to: range.toDisplay,
      },
      periodSummary: {
        loads: book.periodTotals.loads,
        revenue: book.periodTotals.revenue,
        margin: book.periodTotals.margin,
        customersRan: book.active.filter((c) => c.period.loads > 0).length,
      },
      customers: {
        active: book.active.map(withAr),
        dormant: book.dormant.map(withAr),
        dormantDays: DORMANT_DAYS,
      },
      topLanes: rank(inRange, (l) => `${l.origin} → ${l.destination}`, "lane"),
      topCarriers: rank(inRange, (l) => l.carrier, "carrier"),
      weeklyData,
      recordWeek,
    });
  } catch (err) {
    console.error("Broker history error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function trueMargin(l: CountableLoad): number {
  return l.revenue - l.carrierCost - (l.lumperRevenue - l.lumperCost);
}

function trueRevenue(l: CountableLoad): number {
  return l.revenue - l.lumperRevenue;
}

function rank<K extends string>(
  loads: CountableLoad[],
  key: (l: CountableLoad) => string,
  field: K
): Array<Record<K, string> & { loads: number; margin: number }> {
  const map = new Map<string, { loads: number; margin: number }>();
  for (const load of loads) {
    const k = key(load);
    const bucket = map.get(k) ?? { loads: 0, margin: 0 };
    bucket.loads += 1;
    bucket.margin += trueMargin(load);
    map.set(k, bucket);
  }
  return [...map.entries()]
    .map(([value, d]) => ({ [field]: value, loads: d.loads, margin: d.margin }) as Record<K, string> & {
      loads: number;
      margin: number;
    })
    .sort((a, b) => b.loads - a.loads)
    .slice(0, 8);
}

function shiftWeeks(mondayYmd: string, weeks: number): string {
  const d = new Date(`${mondayYmd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Noon on the Sunday that closes the week — see the goal comment above. */
function sundayNoon(mondayYmd: string): Date {
  const d = new Date(`${mondayYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

function labelDay(ymd: string, withYear = false): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(withYear ? { year: "numeric" } : {}),
  });
}
