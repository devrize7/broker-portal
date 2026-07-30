import { NextRequest, NextResponse } from "next/server";
import { requireBrokerAccess } from "@/lib/route-auth";
import { getRoster } from "@/lib/roster";
import { fetchCountableLoads, loadsForBroker, type CountableLoad } from "@/lib/load-query";
import { DORMANT_DAYS } from "@/lib/customer-book";
import { addMonths, daysBetween, parsePreset, resolveRange, startOfMonth, todayET } from "@/lib/date-ranges";

export const dynamic = "force-dynamic";

/** How far back the monthly trend reaches, including the current month. */
const TREND_MONTHS = 13;

/**
 * One customer, through one broker's eyes: the loads they've run in the selected
 * period plus the shape of the relationship over time.
 *
 * Scoped to the broker's OWN loads with that customer, not the customer's whole
 * activity at Oath. A broker seeing another broker's numbers for a shared
 * account would leak exactly what the portal promises it won't — and 22 of 102
 * customers do have loads under more than one rep.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const access = await requireBrokerAccess(params.get("broker"));
  if (!access.ok) return access.response;
  const broker = access.broker;

  const customerParam = (params.get("customer") ?? "").trim();
  if (!customerParam) {
    return NextResponse.json({ error: "customer is required" }, { status: 400 });
  }

  const range = resolveRange(parsePreset(params.get("preset")), {
    from: params.get("from"),
    to: params.get("to"),
  });
  const today = todayET();

  try {
    const [roster, allLoads] = await Promise.all([getRoster(), fetchCountableLoads()]);
    // Trim-tolerant match: customer names in the Load table carry stray
    // whitespace, and a caller only ever holds the trimmed spelling.
    const target = customerParam.toLowerCase();
    const loads = loadsForBroker(allLoads, roster, broker).filter(
      (l) => l.customer.trim().toLowerCase() === target
    );

    if (loads.length === 0) {
      return NextResponse.json({ error: "No loads for this customer" }, { status: 404 });
    }

    const inRange = loads
      .filter((l) => l.pickupYmd >= range.from && l.pickupYmd < range.toExclusive)
      .sort((a, b) => b.pickupYmd.localeCompare(a.pickupYmd));

    let lastLoadDate = loads[0].pickupYmd;
    for (const l of loads) if (l.pickupYmd > lastLoadDate) lastLoadDate = l.pickupYmd;
    // Clamped: future-dated pickups exist and a negative gap reads as nonsense.
    const daysSinceLastLoad = Math.max(0, daysBetween(lastLoadDate, today));

    // ── Monthly trend ─────────────────────────────────────────────────────────
    // Every month in the window is emitted, including empty ones — the gaps ARE
    // the story on a lapsed account, and a sparse series would draw a chart that
    // implies continuous activity.
    const firstMonth = addMonths(startOfMonth(today), -(TREND_MONTHS - 1));
    const monthBuckets = new Map<string, { loads: number; revenue: number; margin: number }>();
    for (let i = 0; i < TREND_MONTHS; i++) {
      monthBuckets.set(addMonths(firstMonth, i).slice(0, 7), { loads: 0, revenue: 0, margin: 0 });
    }
    for (const load of loads) {
      const bucket = monthBuckets.get(load.pickupYmd.slice(0, 7));
      if (!bucket) continue; // outside the trend window
      bucket.loads += 1;
      bucket.revenue += trueRevenue(load);
      bucket.margin += trueMargin(load);
    }
    const monthlyTrend = [...monthBuckets.entries()].map(([month, d]) => ({
      month,
      monthLabel: new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      ...d,
    }));

    return NextResponse.json({
      broker,
      customer: loads[0].customer.trim(),
      status: daysSinceLastLoad <= DORMANT_DAYS ? "active" : "dormant",
      dormantDays: DORMANT_DAYS,
      lastLoadDate,
      daysSinceLastLoad,
      firstLoadDate: loads.reduce((min, l) => (l.pickupYmd < min ? l.pickupYmd : min), loads[0].pickupYmd),
      range: { preset: range.preset, label: range.label, from: range.from, to: range.toDisplay },
      period: summarize(inRange),
      lifetime: summarize(loads),
      monthlyTrend,
      topLanes: rank(inRange, (l) => `${l.origin} → ${l.destination}`, "lane"),
      topCarriers: rank(inRange, (l) => l.carrier, "carrier"),
      loads: inRange.map((l) => ({
        loadNumber: l.loadNumber,
        pickupDate: l.pickupYmd,
        origin: l.origin,
        destination: l.destination,
        carrier: l.carrier,
        status: l.status,
        revenue: trueRevenue(l),
        margin: trueMargin(l),
      })),
    });
  } catch (err) {
    console.error("Broker customer error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function trueMargin(l: CountableLoad): number {
  return l.revenue - l.carrierCost - (l.lumperRevenue - l.lumperCost);
}

function trueRevenue(l: CountableLoad): number {
  return l.revenue - l.lumperRevenue;
}

function summarize(loads: CountableLoad[]) {
  const revenue = loads.reduce((s, l) => s + trueRevenue(l), 0);
  const margin = loads.reduce((s, l) => s + trueMargin(l), 0);
  return {
    loads: loads.length,
    revenue,
    margin,
    marginPct: revenue > 0 ? (margin / revenue) * 100 : 0,
    avgPerLoad: loads.length > 0 ? margin / loads.length : 0,
  };
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
    .map(
      ([value, d]) =>
        ({ [field]: value, loads: d.loads, margin: d.margin }) as Record<K, string> & {
          loads: number;
          margin: number;
        }
    )
    .sort((a, b) => b.loads - a.loads)
    .slice(0, 6);
}
