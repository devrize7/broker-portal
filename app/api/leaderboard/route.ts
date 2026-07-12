import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveActiveBroker, getActiveBrokerNames } from "@/lib/broker-mapping";
import { getRoster, getWeeklyGoal } from "@/lib/roster";
import { trueMargin, trueRevenue } from "@/lib/margin";

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

/** Calendar date (YYYY-MM-DD) of the Sunday ending the week starting on `mondayKey`. */
function weekEndKey(mondayKey: string): string {
  const d = new Date(mondayKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// Weekly goal now comes from the roster feed (getWeeklyGoal in lib/roster.ts) —
// hire dates, ramp weeks and Tom's -100 goalAdjustment live in the dashboard's
// BrokerProfile table, not in a hardcoded mirror here.

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
    const roster = await getRoster();
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

    // The 4 completed week-Monday keys before the target week (hire-capped divisor, OATH-60).
    const completedWeekKeys: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const m = new Date(targetMonday);
      m.setDate(m.getDate() - i * 7);
      m.setHours(0, 0, 0, 0);
      completedWeekKeys.push(m.toISOString().slice(0, 10));
    }

    const loadsResult = await db.execute({
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, profWeek, status, lumperRevenue, lumperCost FROM Load WHERE pickupDate >= ? OR profWeek >= ?`,
      args: [fourWeeksBeforeTarget.toISOString(), fourWeeksBeforeTarget.toISOString().slice(0, 10)],
    });

    const activeBrokers = getActiveBrokerNames(roster);

    // Parse all loads
    const EXCLUDED_STATUSES = ["booked", "committed", "cancelled", "quote", "sent", "ready"];
    interface LoadRow { salesRep: string | null; revenue: number; carrierCost: number; pickupDate: string; profWeek: string | null; status: string | null; lumperRevenue: number; lumperCost: number }
    const allLoads: LoadRow[] = loadsResult.rows.map((row) => ({
      salesRep: row[0] as string | null,
      revenue: Number(row[1]) || 0,
      carrierCost: Number(row[2]) || 0,
      pickupDate: row[3] as string,
      profWeek: row[4] as string | null,
      status: row[5] as string | null,
      lumperRevenue: Number(row[6]) || 0,
      lumperCost: Number(row[7]) || 0,
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
      const { broker, isActive } = resolveActiveBroker(roster, l.salesRep);
      if (!isActive) continue;
      const weekMon = l.profWeek || getMondayOf(new Date(l.pickupDate)).toISOString().slice(0, 10);
      if (!weeklyByBroker[broker]) weeklyByBroker[broker] = {};
      if (!weeklyByBroker[broker][weekMon]) weeklyByBroker[broker][weekMon] = { loads: 0, margin: 0 };
      weeklyByBroker[broker][weekMon].loads += 1;
      weeklyByBroker[broker][weekMon].margin += trueMargin(l.revenue, l.carrierCost, l.lumperRevenue, l.lumperCost);
    }

    // Target week per broker
    const currentByBroker: Record<string, { loads: number; revenue: number; margin: number }> = {};
    for (const l of targetWeekLoads) {
      const { broker, isActive } = resolveActiveBroker(roster, l.salesRep);
      if (!isActive) continue;
      if (!currentByBroker[broker]) currentByBroker[broker] = { loads: 0, revenue: 0, margin: 0 };
      currentByBroker[broker].loads += 1;
      currentByBroker[broker].revenue += trueRevenue(l.revenue, l.lumperRevenue);
      currentByBroker[broker].margin += trueMargin(l.revenue, l.carrierCost, l.lumperRevenue, l.lumperCost);
    }

    // ── All-time RECORD WEEK per broker (best completed week by margin) ───────
    // Matches the command-center scorecard. The windowed fetch above is only 4
    // weeks, so this is a separate all-loads query; the in-progress week is excluded.
    const recRes = await db.execute({
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, profWeek, status, lumperRevenue, lumperCost FROM Load`,
    });
    const recProfWeeks = new Set<string>();
    for (const r of recRes.rows) { const pw = r[4] as string | null; if (pw) recProfWeeks.add(pw); }
    const recByBroker: Record<string, Record<string, number>> = {};
    for (const r of recRes.rows) {
      const { broker, isActive } = resolveActiveBroker(roster, r[0] as string | null);
      if (!isActive) continue;
      const revenue = Number(r[1]) || 0;
      const carrierCost = Number(r[2]) || 0;
      if (revenue === 0 && carrierCost === 0) continue; // phantom $0/$0
      const profWeek = r[4] as string | null;
      let wk: string;
      if (profWeek) wk = profWeek;
      else {
        if (EXCLUDED_STATUSES.includes(((r[5] as string) || "").toLowerCase())) continue;
        wk = getMondayOf(new Date(r[3] as string)).toISOString().slice(0, 10);
        if (recProfWeeks.has(wk)) continue; // profWeek is source of truth
      }
      if (!recByBroker[broker]) recByBroker[broker] = {};
      recByBroker[broker][wk] = (recByBroker[broker][wk] || 0) + trueMargin(revenue, carrierCost, Number(r[6]) || 0, Number(r[7]) || 0);
    }
    const brokerRecords: Record<string, { amount: number; weekOf: string }> = {};
    for (const [broker, weeks] of Object.entries(recByBroker)) {
      let amount = 0, weekOf = "";
      for (const [wk, m] of Object.entries(weeks)) {
        if (wk === thisMondayKey) continue; // exclude in-progress week
        if (m > amount) { amount = m; weekOf = wk; }
      }
      brokerRecords[broker] = { amount, weekOf };
    }

    const rows = activeBrokers.map((broker) => {
      const cur = currentByBroker[broker] || { loads: 0, revenue: 0, margin: 0 };
      const weeklyGoal = getWeeklyGoal(roster, broker, targetMonday);

      // Last 4 completed weeks (OATH-60): divide by the number of those 4 weeks
      // on/after the broker's hire week (capped at 4, min 1) — completed $0 weeks
      // count and drag the average down; new hires aren't penalized for weeks
      // before they existed.
      const brokerWeeks = Object.values(weeklyByBroker[broker] || {});
      const totalMargin = brokerWeeks.reduce((s, w) => s + w.margin, 0);
      const totalLoads = brokerWeeks.reduce((s, w) => s + w.loads, 0);
      // hireDate is already a YYYY-MM-DD calendar date; compare directly (no
      // getMondayOf, which would shift it into the prior ET week).
      const hireStr = roster.byName.get(broker)?.hireDate ?? null;
      let eligibleWeeks = 4;
      if (hireStr) {
        eligibleWeeks = completedWeekKeys.filter((k) => weekEndKey(k) >= hireStr).length;
      }
      const divisor = Math.max(1, eligibleWeeks);
      const avgMargin = totalMargin / divisor;
      const avgLoads = totalLoads / divisor;

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
        record: brokerRecords[broker] || { amount: 0, weekOf: "" },
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
