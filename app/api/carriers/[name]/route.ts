import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveActiveBroker } from "@/lib/broker-mapping";

export const dynamic = "force-dynamic";

function getMondayOf(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(date);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value) - 1;
  const day = parseInt(parts.find(p => p.type === 'day')!.value);
  const weekdayStr = parts.find(p => p.type === 'weekday')!.value;
  const dayOfWeek = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(weekdayStr);
  const d = new Date(year, month, day);
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function lookupDot(carrierName: string): Promise<string | null> {
  const key = process.env.FMCSA_API_KEY;
  if (!key) return null;
  try {
    const encoded = encodeURIComponent(carrierName);
    const res = await fetch(
      `https://mobile.fmcsa.dot.gov/qc/services/carriers/name/${encoded}?webKey=${key}`,
      { next: { revalidate: 86400 } } // cache 24h
    );
    if (!res.ok) return null;
    const json = await res.json();
    const carriers = json?.content ?? [];
    if (carriers.length === 0) return null;
    // Pick the closest name match
    const dotNumber = carriers[0]?.carrier?.dotNumber ?? carriers[0]?.dotNumber;
    return dotNumber ? String(dotNumber) : null;
  } catch {
    return null;
  }
}

const EXCLUDED = ["booked", "committed", "cancelled", "quote", "sent"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const carrierName = decodeURIComponent(name);
  const weeks = Math.min(parseInt(req.nextUrl.searchParams.get("weeks") ?? "12", 10), 52);

  try {
    const now = new Date();
    const thisMonday = getMondayOf(now);
    const since = new Date(thisMonday);
    since.setDate(since.getDate() - weeks * 7);

    const excluded = EXCLUDED.map(() => "?").join(",");
    const result = await db.execute({
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, origin, destination, carrier, loadNumber, profWeek
            FROM Load
            WHERE carrier = ? AND (pickupDate >= ? OR profWeek >= ?) AND status NOT IN (${excluded})
            ORDER BY pickupDate DESC`,
      args: [carrierName, since.toISOString(), since.toISOString().slice(0, 10), ...EXCLUDED],
    });

    // Weeks that have profWeek data (source of truth for weekly grouping)
    const weeksWithProfData = new Set<string>();
    for (const row of result.rows) {
      const pw = row[8] as string | null;
      if (pw) weeksWithProfData.add(pw);
    }

    const weekMap: Record<string, { loads: number; spend: number; margin: number; weekMonday: Date }> = {};
    const laneMap: Record<string, { loads: number; spend: number; margin: number; origins: Set<string>; destinations: Set<string> }> = {};
    const brokerMap: Record<string, { loads: number; spend: number; margin: number }> = {};
    const stateSet = new Set<string>();
    const recentLoads: {
      loadNumber: string; date: string; origin: string; destination: string;
      spend: number; margin: number; broker: string;
    }[] = [];

    for (const row of result.rows) {
      const revenue = Number(row[1]) || 0;
      const carrierCost = Number(row[2]) || 0;
      if (revenue === 0 && carrierCost === 0) continue;

      const margin = revenue - carrierCost;
      const pickupDate = row[3] as string;
      const origin = (row[4] as string) || "";
      const destination = (row[5] as string) || "";
      const loadNumber = (row[7] as string) || "";
      const profWeek = row[8] as string | null;
      const salesRep = row[0] as string | null;

      const { broker } = resolveActiveBroker(salesRep);

      // Weekly grouping
      let weekKey: string;
      if (profWeek) {
        weekKey = profWeek;
      } else {
        weekKey = getMondayOf(new Date(pickupDate)).toISOString().slice(0, 10);
        if (weeksWithProfData.has(weekKey)) continue;
      }

      const weekMon = new Date(weekKey + "T00:00:00");
      if (!weekMap[weekKey]) {
        weekMap[weekKey] = { loads: 0, spend: 0, margin: 0, weekMonday: weekMon };
      }
      weekMap[weekKey].loads += 1;
      weekMap[weekKey].spend += carrierCost;
      weekMap[weekKey].margin += margin;

      // Lanes
      const laneKey = `${origin} → ${destination}`;
      if (!laneMap[laneKey]) {
        laneMap[laneKey] = { loads: 0, spend: 0, margin: 0, origins: new Set(), destinations: new Set() };
      }
      laneMap[laneKey].loads += 1;
      laneMap[laneKey].spend += carrierCost;
      laneMap[laneKey].margin += margin;

      // States
      const os = origin.split(",")[1]?.trim();
      const ds = destination.split(",")[1]?.trim();
      if (os) stateSet.add(os);
      if (ds) stateSet.add(ds);

      // Broker usage
      if (!brokerMap[broker]) brokerMap[broker] = { loads: 0, spend: 0, margin: 0 };
      brokerMap[broker].loads += 1;
      brokerMap[broker].spend += carrierCost;
      brokerMap[broker].margin += margin;

      // Recent loads (cap at 50)
      if (recentLoads.length < 50) {
        recentLoads.push({ loadNumber, date: pickupDate, origin, destination, spend: carrierCost, margin, broker });
      }
    }

    // Totals
    const totalLoads = Object.values(weekMap).reduce((s, w) => s + w.loads, 0);
    const totalSpend = Object.values(weekMap).reduce((s, w) => s + w.spend, 0);
    const totalMargin = Object.values(weekMap).reduce((s, w) => s + w.margin, 0);

    // Weekly trend sorted oldest → newest
    const weeklyTrend = Object.entries(weekMap)
      .map(([weekKey, d]) => ({
        weekKey,
        weekLabel: new Date(weekKey + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        loads: d.loads,
        spend: d.spend,
        margin: d.margin,
        isCurrent: weekKey === thisMonday.toISOString().slice(0, 10),
      }))
      .sort((a, b) => a.weekKey.localeCompare(b.weekKey));

    const topLanes = Object.entries(laneMap)
      .map(([lane, d]) => ({ lane, loads: d.loads, spend: d.spend, margin: d.margin, avgCost: d.loads > 0 ? d.spend / d.loads : 0 }))
      .sort((a, b) => b.loads - a.loads)
      .slice(0, 10);

    const brokerBreakdown = Object.entries(brokerMap)
      .map(([broker, d]) => ({ broker, loads: d.loads, spend: d.spend, margin: d.margin }))
      .sort((a, b) => b.loads - a.loads);

    // Highway search URL — opens Highway's carrier search pre-filled with the carrier name
    const highwaySearchUrl = `https://highway.com/broker/carriers?search=${encodeURIComponent(carrierName)}`;

    return NextResponse.json({
      carrier: carrierName,
      totalLoads,
      totalSpend,
      totalMargin,
      avgCostPerLoad: totalLoads > 0 ? totalSpend / totalLoads : 0,
      avgMarginPerLoad: totalLoads > 0 ? totalMargin / totalLoads : 0,
      states: Array.from(stateSet).sort(),
      weeklyTrend,
      topLanes,
      brokerBreakdown,
      recentLoads,
      highwaySearchUrl,
    });
  } catch (err) {
    console.error("Carrier profile error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
