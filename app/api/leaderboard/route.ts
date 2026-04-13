import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveActiveBroker, getActiveBrokerNames } from "@/lib/broker-mapping";

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
  const d = new Date(Date.UTC(year, month, day));
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

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

function weekPaceFactor(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const weekdayStr = parts.find(p => p.type === 'weekday')!.value;
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(weekdayStr);
  const hour = parseInt(parts.find(p => p.type === 'hour')!.value) + parseInt(parts.find(p => p.type === 'minute')!.value) / 60;
  if (day === 0) return 0;
  if (day === 6) return 1;
  const dayIndex = day - 1;
  const dayProgress = Math.min(Math.max((hour - 8) / 10, 0), 1);
  return Math.min((dayIndex + dayProgress) / 5, 1);
}

export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    const thisMonday = getMondayOf(now);
    const thisMondayKey = thisMonday.toISOString().slice(0, 10);

    // Week offset: 0 = current, -1 = last week, -2 = 2 weeks ago, etc.
    const weekOffset = parseInt(request.nextUrl.searchParams.get("week") || "0", 10);
    const targetMonday = new Date(thisMonday);
    targetMonday.setDate(targetMonday.getDate() + weekOffset * 7);
    const targetMondayKey = targetMonday.toISOString().slice(0, 10);
    const isCurrentWeek = weekOffset === 0;

    const paceFactor = isCurrentWeek ? weekPaceFactor(now) : 1;

    // Fetch all loads with profWeek or recent pickupDate for rolling avg
    const fourWeeksBeforeTarget = new Date(targetMonday);
    fourWeeksBeforeTarget.setDate(fourWeeksBeforeTarget.getDate() - 28);

    const loadsResult = await db.execute({
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, profWeek, status FROM Load WHERE pickupDate >= ? OR profWeek >= ?`,
      args: [fourWeeksBeforeTarget.toISOString(), fourWeeksBeforeTarget.toISOString().slice(0, 10)],
    });

    const activeBrokers = getActiveBrokerNames();

    // Parse all loads
    const EXCLUDED_STATUSES = ["booked", "committed", "cancelled", "quote", "sent"];
    interface LoadRow { salesRep: string | null; revenue: number; carrierCost: number; pickupDate: string; profWeek: string | null; status: string | null }
    const allLoads: LoadRow[] = loadsResult.rows.map((row) => ({
      salesRep: row[0] as string | null,
      revenue: Number(row[1]) || 0,
      carrierCost: Number(row[2]) || 0,
      pickupDate: row[3] as string,
      profWeek: row[4] as string | null,
      status: row[5] as string | null,
    }));

    // Target week loads: use profWeek as source of truth
    const profWeekLoads = allLoads.filter((l) => l.profWeek === targetMondayKey);
    const targetSunday = new Date(targetMonday);
    targetSunday.setDate(targetSunday.getDate() + 6);
    targetSunday.setHours(23, 59, 59, 999);

    const targetWeekLoads = profWeekLoads.length > 0
      ? profWeekLoads
      : allLoads.filter((l) => {
          if (l.profWeek) return false; // skip loads tagged for other weeks
          if (l.revenue === 0 && l.carrierCost === 0) return false; // skip phantom $0/$0 loads
          if (EXCLUDED_STATUSES.includes((l.status || "").toLowerCase())) return false; // dispatched+ only
          const pd = new Date(l.pickupDate);
          return pd >= targetMonday && pd <= targetSunday;
        });

    // Prior weeks for rolling avg (4 weeks before target week)
    const weeksWithProfData = new Set<string>();
    for (const l of allLoads) {
      if (l.profWeek && l.profWeek < targetMondayKey) weeksWithProfData.add(l.profWeek);
    }

    const priorWeeksLoads = allLoads.filter((l) => {
      // Always exclude $0/$0 phantom loads
      if (l.revenue === 0 && l.carrierCost === 0) return false;
      if (l.profWeek && l.profWeek < targetMondayKey && l.profWeek >= fourWeeksBeforeTarget.toISOString().slice(0, 10)) return true;
      if (!l.profWeek) {
        // No profWeek — apply status filter (profWeek loads already passed Tai's status filter)
        if (EXCLUDED_STATUSES.includes((l.status || "").toLowerCase())) return false;
        const pd = new Date(l.pickupDate);
        const weekKey = getMondayOf(pd).toISOString().slice(0, 10);
        if (weekKey >= targetMondayKey) return false;
        if (weekKey < fourWeeksBeforeTarget.toISOString().slice(0, 10)) return false;
        if (weeksWithProfData.has(weekKey)) return false;
        return true;
      }
      return false;
    });

    // Rolling avg: broker -> weekKey -> stats
    const weeklyByBroker: Record<string, Record<string, { loads: number; margin: number }>> = {};
    for (const l of priorWeeksLoads) {
      const { broker, isActive } = resolveActiveBroker(l.salesRep);
      if (!isActive) continue;
      const weekMon = l.profWeek || getMondayOf(new Date(l.pickupDate)).toISOString().slice(0, 10);
      if (!weeklyByBroker[broker]) weeklyByBroker[broker] = {};
      if (!weeklyByBroker[broker][weekMon]) weeklyByBroker[broker][weekMon] = { loads: 0, margin: 0 };
      weeklyByBroker[broker][weekMon].loads += 1;
      weeklyByBroker[broker][weekMon].margin += l.revenue - l.carrierCost;
    }

    // Target week per broker
    const currentByBroker: Record<string, { loads: number; revenue: number; margin: number }> = {};
    for (const l of targetWeekLoads) {
      const { broker, isActive } = resolveActiveBroker(l.salesRep);
      if (!isActive) continue;
      if (!currentByBroker[broker]) currentByBroker[broker] = { loads: 0, revenue: 0, margin: 0 };
      currentByBroker[broker].loads += 1;
      currentByBroker[broker].revenue += l.revenue;
      currentByBroker[broker].margin += l.revenue - l.carrierCost;
    }

    const rows = activeBrokers.map((broker) => {
      const cur = currentByBroker[broker] || { loads: 0, revenue: 0, margin: 0 };
      const weeklyGoal = getWeeklyGoal(broker, targetMonday);

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
        pacedGoal,
        marginDelta: avgMargin > 0 ? cur.margin - avgMargin : null,
      };
    });

    rows.sort((a, b) => {
      if (a.current.loads === 0 && b.current.loads > 0) return 1;
      if (a.current.loads > 0 && b.current.loads === 0) return -1;
      return b.current.margin - a.current.margin;
    });

    return NextResponse.json({
      weekStart: targetMondayKey,
      weekOffset,
      isCurrentWeek,
      updatedAt: now.toISOString(),
      paceFactor,
      brokers: rows,
    });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
