import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { resolveActiveBroker } from "@/lib/broker-mapping";

export const dynamic = "force-dynamic";

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const EXCLUDED = ["booked", "committed", "cancelled", "quote", "sent"];

const BROKER_HIRE_DATES: Record<string, string> = {
  "Tom Licata":       "2025-08-18",
  "Joe Corbett":      "2025-03-31",
  "David Gheran":     "2026-01-19",
  "James Davison":    "2025-09-29",
  "Drew Ivey":        "2025-06-02",
  "Raphael Jackson":  "2026-01-19",
  "Ivan Moya":        "2026-01-19",
  "Grant Morse":      "2026-01-05",
  "Brian Pollock":    "2026-03-23",
  "Alonzo Hunt":      "2026-03-23",
};
const NON_EXPERIENCED = new Set(["David Gheran", "Ivan Moya"]);

function getWeeklyGoal(broker: string, weekMonday: Date): number {
  const hireStr = BROKER_HIRE_DATES[broker];
  if (!hireStr) return 0;
  const hireDate = new Date(hireStr);
  const totalWeeks = Math.floor(
    (weekMonday.getTime() - hireDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  const rampWeeks = NON_EXPERIENCED.has(broker) ? 12 : 6;
  if (totalWeeks < rampWeeks) return 0;
  const weeksOnGoal = totalWeeks - rampWeeks + 2;
  const adjustment = broker === "Tom Licata" ? -100 : 0;
  return Math.max(0, weeksOnGoal * 100 + adjustment);
}

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
      const { broker, isActive } = resolveActiveBroker(salesRep);
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
        goal: getWeeklyGoal(requestedBroker, data.weekMonday),
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

    return NextResponse.json({
      broker: requestedBroker,
      weeklyData,
      topLanes,
      topCarriers,
    });
  } catch (err) {
    console.error("Broker history error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
