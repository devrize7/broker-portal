import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveActiveBroker, getActiveBrokerNames } from "@/lib/broker-mapping";

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

// ── Weekly goal formula (mirrors freight-dashboard lib/queries.ts) ──────────
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
const NON_EXPERIENCED = new Set(["David Gheran", "Ivan Moya"]); // 12-week ramp

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
// ────────────────────────────────────────────────────────────────────────────

function weekPaceFactor(now: Date): number {
  const day = now.getDay();
  const hour = now.getHours() + now.getMinutes() / 60;
  if (day === 0) return 0;
  if (day === 6) return 1;
  const dayIndex = day - 1;
  const dayProgress = Math.min(Math.max((hour - 8) / 10, 0), 1);
  return Math.min((dayIndex + dayProgress) / 5, 1);
}

export async function GET() {
  try {
    const now = new Date();
    const thisMonday = getMondayOf(now);
    const paceFactor = weekPaceFactor(now);

    const fourWeeksAgo = new Date(thisMonday);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const excluded = EXCLUDED.map(() => "?").join(",");
    const [loadsResult] = await Promise.all([
      db.execute({
        sql: `SELECT salesRep, revenue, carrierCost, pickupDate FROM Load WHERE pickupDate >= ? AND status NOT IN (${excluded})`,
        args: [fourWeeksAgo.toISOString(), ...EXCLUDED],
      }),
    ]);

    const activeBrokers = getActiveBrokerNames();

    const currentWeekLoads: { salesRep: string | null; revenue: number; carrierCost: number; pickupDate: string }[] = [];
    const priorWeeksLoads: typeof currentWeekLoads = [];

    for (const row of loadsResult.rows) {
      const load = {
        salesRep: row[0] as string | null,
        revenue: row[1] as number,
        carrierCost: row[2] as number,
        pickupDate: row[3] as string,
      };
      if (new Date(load.pickupDate) >= thisMonday) currentWeekLoads.push(load);
      else priorWeeksLoads.push(load);
    }

    const weeklyByBroker: Record<string, Record<string, { loads: number; margin: number }>> = {};
    for (const l of priorWeeksLoads) {
      const { broker, isActive } = resolveActiveBroker(l.salesRep);
      if (!isActive) continue;
      const weekMon = getMondayOf(new Date(l.pickupDate)).toISOString().slice(0, 10);
      if (!weeklyByBroker[broker]) weeklyByBroker[broker] = {};
      if (!weeklyByBroker[broker][weekMon]) weeklyByBroker[broker][weekMon] = { loads: 0, margin: 0 };
      weeklyByBroker[broker][weekMon].loads += 1;
      weeklyByBroker[broker][weekMon].margin += l.revenue - l.carrierCost;
    }

    const currentByBroker: Record<string, { loads: number; revenue: number; margin: number }> = {};
    for (const l of currentWeekLoads) {
      const { broker, isActive } = resolveActiveBroker(l.salesRep);
      if (!isActive) continue;
      if (!currentByBroker[broker]) currentByBroker[broker] = { loads: 0, revenue: 0, margin: 0 };
      currentByBroker[broker].loads += 1;
      currentByBroker[broker].revenue += l.revenue;
      currentByBroker[broker].margin += l.revenue - l.carrierCost;
    }

    const rows = activeBrokers.map((broker) => {
      const cur = currentByBroker[broker] || { loads: 0, revenue: 0, margin: 0 };
      const weeklyGoal = getWeeklyGoal(broker, thisMonday);

      const weeks = Object.values(weeklyByBroker[broker] || {});
      const weeksWithLoads = weeks.filter((w) => w.loads > 0);
      const avgMargin = weeksWithLoads.length > 0
        ? weeksWithLoads.reduce((s, w) => s + w.margin, 0) / weeksWithLoads.length : 0;
      const avgLoads = weeksWithLoads.length > 0
        ? weeksWithLoads.reduce((s, w) => s + w.loads, 0) / weeksWithLoads.length : 0;

      const pacedGoal = weeklyGoal * paceFactor;
      const paceStatus: "ahead" | "on_pace" | "behind" | "no_goal" =
        weeklyGoal === 0 ? "no_goal"
          : cur.margin >= pacedGoal * 1.1 ? "ahead"
          : cur.margin >= pacedGoal * 0.85 ? "on_pace"
          : "behind";

      return {
        broker,
        weeklyGoal,
        current: {
          loads: cur.loads,
          revenue: cur.revenue,
          margin: cur.margin,
          avgPerLoad: cur.loads > 0 ? cur.margin / cur.loads : 0,
          marginPct: cur.revenue > 0 ? (cur.margin / cur.revenue) * 100 : 0,
        },
        rolling4wAvg: { loads: Math.round(avgLoads * 10) / 10, margin: avgMargin },
        goalPct: weeklyGoal > 0 ? Math.min((cur.margin / weeklyGoal) * 100, 999) : null,
        paceStatus,
        marginDelta: avgMargin > 0 ? cur.margin - avgMargin : null,
      };
    });

    rows.sort((a, b) => {
      if (a.current.loads === 0 && b.current.loads > 0) return 1;
      if (a.current.loads > 0 && b.current.loads === 0) return -1;
      return b.current.margin - a.current.margin;
    });

    return NextResponse.json({ weekStart: thisMonday.toISOString().slice(0, 10), updatedAt: now.toISOString(), paceFactor, brokers: rows });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
