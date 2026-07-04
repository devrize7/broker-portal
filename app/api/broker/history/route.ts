import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { resolveActiveBroker } from "@/lib/broker-mapping";
import { getRoster, getWeeklyGoal } from "@/lib/roster";

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

const EXCLUDED = ["booked", "committed", "cancelled", "quote", "sent"];

// Weekly goal (hire dates / ramp / Tom's -100) comes from the roster feed —
// getWeeklyGoal in lib/roster.ts. No hardcoded mirror here.

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { brokerName?: string | null; isAdmin?: boolean };
  const requestedBroker = req.nextUrl.searchParams.get("broker");

  if (!requestedBroker || (!user.isAdmin && user.brokerName !== requestedBroker)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const weeks = Math.min(parseInt(req.nextUrl.searchParams.get("weeks") ?? "12", 10), 52);

  try {
    const roster = await getRoster();
    const now = new Date();
    const thisMonday = getMondayOf(now);
    const since = new Date(thisMonday);
    since.setDate(since.getDate() - weeks * 7);

    const excluded = EXCLUDED.map(() => "?").join(",");
    const result = await db.execute({
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, origin, destination, carrier, profWeek
            FROM Load
            WHERE (pickupDate >= ? OR profWeek >= ?) AND status NOT IN (${excluded})
            ORDER BY pickupDate ASC`,
      args: [since.toISOString(), since.toISOString().slice(0, 10), ...EXCLUDED],
    });

    // Build set of weeks with profWeek-tagged data
    const weeksWithProfData = new Set<string>();
    for (const row of result.rows) {
      const pw = row[7] as string | null;
      if (pw) weeksWithProfData.add(pw);
    }

    // Group by week
    const weekMap: Record<string, { loads: number; revenue: number; margin: number; weekMonday: Date }> = {};
    const laneMap: Record<string, { loads: number; margin: number }> = {};
    const carrierMap: Record<string, { loads: number; margin: number }> = {};

    for (const row of result.rows) {
      const salesRep = row[0] as string | null;
      const { broker, isActive } = resolveActiveBroker(roster, salesRep);
      if (!isActive || broker !== requestedBroker) continue;

      const revenue = row[1] as number;
      const carrierCost = row[2] as number;
      // Skip $0/$0 phantom loads
      if (revenue === 0 && carrierCost === 0) continue;
      const margin = revenue - carrierCost;
      const pickupDate = row[3] as string;
      const origin = row[4] as string;
      const destination = row[5] as string;
      const carrier = (row[6] as string) || "Unknown";
      const profWeek = row[7] as string | null;

      // Use profWeek as source of truth for week assignment
      let weekKey: string;
      if (profWeek) {
        weekKey = profWeek;
      } else {
        weekKey = getMondayOf(new Date(pickupDate)).toISOString().slice(0, 10);
        // Skip untagged loads for weeks that have profWeek data
        if (weeksWithProfData.has(weekKey)) continue;
      }

      const weekMon = new Date(weekKey + "T00:00:00");
      if (!weekMap[weekKey]) {
        weekMap[weekKey] = { loads: 0, revenue: 0, margin: 0, weekMonday: weekMon };
      }
      weekMap[weekKey].loads += 1;
      weekMap[weekKey].revenue += revenue;
      weekMap[weekKey].margin += margin;

      const laneKey = `${origin} → ${destination}`;
      if (!laneMap[laneKey]) laneMap[laneKey] = { loads: 0, margin: 0 };
      laneMap[laneKey].loads += 1;
      laneMap[laneKey].margin += margin;

      if (!carrierMap[carrier]) carrierMap[carrier] = { loads: 0, margin: 0 };
      carrierMap[carrier].loads += 1;
      carrierMap[carrier].margin += margin;
    }

    // Build weekly array including current partial week, sorted oldest → newest
    const weeklyData = Object.entries(weekMap)
      .map(([weekKey, data]) => ({
        weekKey,
        weekLabel: new Date(weekKey + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        loads: data.loads,
        revenue: data.revenue,
        margin: data.margin,
        goal: getWeeklyGoal(roster, requestedBroker, data.weekMonday),
        isCurrent: weekKey === thisMonday.toISOString().slice(0, 10),
      }))
      .sort((a, b) => a.weekKey.localeCompare(b.weekKey));

    const topLanes = Object.entries(laneMap)
      .map(([lane, d]) => ({ lane, loads: d.loads, margin: d.margin }))
      .sort((a, b) => b.loads - a.loads)
      .slice(0, 8);

    const topCarriers = Object.entries(carrierMap)
      .map(([carrier, d]) => ({ carrier, loads: d.loads, margin: d.margin }))
      .sort((a, b) => b.loads - a.loads)
      .slice(0, 8);

    // ── All-time RECORD WEEK (best completed week by margin) ──────────────────
    // Separate from the windowed weeklyData above — the record must look back over
    // the broker's whole tenure, not just the 8/12/26-week view. The in-progress
    // week is excluded (a partial week can't be a record).
    const recRes = await db.execute({
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, profWeek FROM Load WHERE status NOT IN (${excluded})`,
      args: [...EXCLUDED],
    });
    const recProfWeeks = new Set<string>();
    for (const row of recRes.rows) { const pw = row[4] as string | null; if (pw) recProfWeeks.add(pw); }
    const recWeekMap: Record<string, { margin: number; loads: number }> = {};
    for (const row of recRes.rows) {
      const { broker, isActive } = resolveActiveBroker(roster, row[0] as string | null);
      if (!isActive || broker !== requestedBroker) continue;
      const revenue = row[1] as number;
      const carrierCost = row[2] as number;
      if (revenue === 0 && carrierCost === 0) continue; // phantom $0/$0
      const profWeek = row[4] as string | null;
      let weekKey: string;
      if (profWeek) weekKey = profWeek;
      else { weekKey = getMondayOf(new Date(row[3] as string)).toISOString().slice(0, 10); if (recProfWeeks.has(weekKey)) continue; }
      if (!recWeekMap[weekKey]) recWeekMap[weekKey] = { margin: 0, loads: 0 };
      recWeekMap[weekKey].margin += revenue - carrierCost;
      recWeekMap[weekKey].loads += 1;
    }
    const thisMondayKey = thisMonday.toISOString().slice(0, 10);
    let recordWeek: { weekKey: string; weekLabel: string; margin: number; loads: number } | null = null;
    for (const [weekKey, d] of Object.entries(recWeekMap)) {
      if (weekKey === thisMondayKey) continue; // exclude the in-progress week
      if (!recordWeek || d.margin > recordWeek.margin) {
        recordWeek = {
          weekKey,
          weekLabel: new Date(weekKey + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          margin: d.margin,
          loads: d.loads,
        };
      }
    }

    return NextResponse.json({
      broker: requestedBroker,
      weeklyData,
      topLanes,
      topCarriers,
      recordWeek,
    });
  } catch (err) {
    console.error("Broker history error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
