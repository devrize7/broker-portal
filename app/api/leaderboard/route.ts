import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/route-auth";
import { db } from "@/lib/db";
import { resolveActiveBroker, getActiveBrokerNames } from "@/lib/broker-mapping";
import { getRoster, getWeeklyGoal, getRampStatus } from "@/lib/roster";
import { trueMargin, trueRevenue } from "@/lib/margin";
import { isRealLoad } from "@/lib/load-countability";
import { parseLeaderboardPeriod, resolveLeaderboardPeriod } from "@/lib/leaderboard-periods";
import { addDays } from "@/lib/date-ranges";
import {
  mondayKeyForInstant,
  pickupInRange,
  utcMidnight,
  weekKeyOfPickup,
  weekPaceFactor,
} from "@/lib/leaderboard-week";

export const dynamic = "force-dynamic";

/** Calendar date (YYYY-MM-DD) of the Sunday ending the week starting on `mondayKey`. */
function weekEndKey(mondayKey: string): string {
  return addDays(mondayKey, 6);
}

// Weekly goal now comes from the roster feed (getWeeklyGoal in lib/roster.ts) —
// hire dates, ramp weeks and Tom's -100 goalAdjustment live in the dashboard's
// BrokerProfile table, not in a hardcoded mirror here.

export async function GET(request: NextRequest) {
  const { session, response } = await requireSession();
  if (!session) return response;

  try {
    const roster = await getRoster();
    const now = new Date();
    const period = parseLeaderboardPeriod(request.nextUrl.searchParams.get("period"));
    const weekOffset = parseInt(request.nextUrl.searchParams.get("week") || "0", 10);

    // Weekly remains the original leaderboard path below, including its goals,
    // pace, rolling average, and record-week calculations. Other periods reuse
    // the same TIE/TMS load columns and broker mapping, changing only the
    // date-window aggregation.
    if (period !== "weekly") {
      const range = resolveLeaderboardPeriod(period, { now });
      const loadsResult = await db.execute({
        sql: `SELECT salesRep, revenue, carrierCost, pickupDate, profWeek, status, lumperRevenue, lumperCost, carrier FROM Load`,
      });
      const EXCLUDED_STATUSES = ["booked", "committed", "cancelled", "quote", "sent", "ready"];
      interface LoadRow { salesRep: string | null; revenue: number; carrierCost: number; pickupDate: string; profWeek: string | null; status: string | null; lumperRevenue: number; lumperCost: number; carrier: string | null }
      const allLoads: LoadRow[] = loadsResult.rows.map((row) => ({
        salesRep: row[0] as string | null,
        revenue: Number(row[1]) || 0,
        carrierCost: Number(row[2]) || 0,
        pickupDate: row[3] as string,
        profWeek: row[4] as string | null,
        status: row[5] as string | null,
        lumperRevenue: Number(row[6]) || 0,
        lumperCost: Number(row[7]) || 0,
        carrier: row[8] as string | null,
      }));
      const currentByBroker: Record<string, { loads: number; revenue: number; margin: number }> = {};

      for (const load of allLoads) {
        if (!isRealLoad(load)) continue;
        if (!load.profWeek && EXCLUDED_STATUSES.includes((load.status || "").toLowerCase())) continue;
        // Month / quarter / year follow the pickup's ET calendar date. Bucketing
        // by the week's Monday (or by profWeek) pulled Oct 1–4 into September
        // because that week opened on Sep 28.
        if (!load.pickupDate || !pickupInRange(load.pickupDate, range.from, range.toExclusive)) continue;
        const { broker, isActive } = resolveActiveBroker(roster, load.salesRep);
        if (!isActive) continue;
        if (!currentByBroker[broker]) currentByBroker[broker] = { loads: 0, revenue: 0, margin: 0 };
        currentByBroker[broker].loads += 1;
        currentByBroker[broker].revenue += trueRevenue(load.revenue, load.lumperRevenue);
        currentByBroker[broker].margin += trueMargin(load.revenue, load.carrierCost, load.lumperRevenue, load.lumperCost);
      }

      const rows = getActiveBrokerNames(roster).map((broker) => {
        const current = currentByBroker[broker] || { loads: 0, revenue: 0, margin: 0 };
        return {
          broker,
          weeklyGoal: 0,
          ramping: false,
          rampWeeksLeft: 0,
          goalStartDate: null,
          current: {
            ...current,
            avgPerLoad: current.loads > 0 ? current.margin / current.loads : 0,
            marginPct: current.revenue > 0 ? (current.margin / current.revenue) * 100 : 0,
          },
          rolling4wAvg: { loads: 0, margin: 0 },
          goalPct: null,
          paceStatus: "no_goal" as const,
          pacedGoal: 0,
          marginDelta: null,
          record: { amount: 0, weekOf: "" },
        };
      });
      rows.sort((a, b) => {
        if (a.current.loads === 0 && b.current.loads > 0) return 1;
        if (a.current.loads > 0 && b.current.loads === 0) return -1;
        return b.current.margin - a.current.margin;
      });

      return NextResponse.json({
        period,
        periodStart: range.from,
        periodEnd: range.toDisplay,
        periodLabel: range.label,
        weekStart: range.from,
        weekOffset: 0,
        isCurrentWeek: false,
        updatedAt: now.toISOString(),
        paceFactor: 1,
        brokers: rows,
      });
    }

    // Current and target weeks are ET calendar Mondays (Mon 12:00 AM–Sun 11:59 PM).
    // `utcMidnight` is only for goal/ramp math, which subtracts UTC-midnight hire dates.
    const thisMondayKey = mondayKeyForInstant(now);
    const targetMondayKey = mondayKeyForInstant(now, weekOffset);
    const targetMonday = utcMidnight(targetMondayKey);
    const isCurrentWeek = weekOffset === 0;

    const paceFactor = isCurrentWeek ? weekPaceFactor(now) : 1;

    // Fetch all loads with profWeek or recent pickupDate for rolling avg.
    // The lower bound is UTC midnight of that Monday, which is before Monday
    // 12:00 AM ET, so an early-Monday pickup is not dropped by the SQL filter.
    // Week membership itself is decided in memory on the ET calendar date.
    const fourWeeksBeforeKey = addDays(targetMondayKey, -28);

    // The 4 completed week-Monday keys before the target week (hire-capped divisor, OATH-60).
    const completedWeekKeys: string[] = [];
    for (let i = 1; i <= 4; i++) {
      completedWeekKeys.push(addDays(targetMondayKey, -i * 7));
    }

    const loadsResult = await db.execute({
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, profWeek, status, lumperRevenue, lumperCost, carrier FROM Load WHERE pickupDate >= ? OR profWeek >= ?`,
      args: [`${fourWeeksBeforeKey}T00:00:00.000Z`, fourWeeksBeforeKey],
    });

    const activeBrokers = getActiveBrokerNames(roster);

    // Parse all loads
    const EXCLUDED_STATUSES = ["booked", "committed", "cancelled", "quote", "sent", "ready"];
    interface LoadRow { salesRep: string | null; revenue: number; carrierCost: number; pickupDate: string; profWeek: string | null; status: string | null; lumperRevenue: number; lumperCost: number; carrier: string | null }
    const allLoads: LoadRow[] = loadsResult.rows.map((row) => ({
      salesRep: row[0] as string | null,
      revenue: Number(row[1]) || 0,
      carrierCost: Number(row[2]) || 0,
      pickupDate: row[3] as string,
      profWeek: row[4] as string | null,
      status: row[5] as string | null,
      lumperRevenue: Number(row[6]) || 0,
      lumperCost: Number(row[7]) || 0,
      carrier: row[8] as string | null,
    }));

    // Target week loads: use profWeek as source of truth
    // The CSV pre-filtered on STATUS, not on whether a carrier was ever booked,
    // so a tagged load still needs the financial check (matches the command
    // center's belongsToRange, which applies it before the profWeek branch).
    const profWeekLoads = allLoads.filter((l) => l.profWeek === targetMondayKey && isRealLoad(l));
    const targetWeekEndExclusive = addDays(targetMondayKey, 7);

    const targetWeekLoads = profWeekLoads.length > 0
      ? profWeekLoads
      : allLoads.filter((l) => {
          if (l.profWeek) return false; // skip loads tagged for other weeks
          if (!isRealLoad(l)) return false; // no real financials (see isRealLoad)
          if (EXCLUDED_STATUSES.includes((l.status || "").toLowerCase())) return false; // dispatched+ only
          if (!l.pickupDate) return false;
          return pickupInRange(l.pickupDate, targetMondayKey, targetWeekEndExclusive);
        });

    // Prior weeks for rolling avg (4 weeks before target week)
    const weeksWithProfData = new Set<string>();
    for (const l of allLoads) {
      if (l.profWeek && l.profWeek < targetMondayKey) weeksWithProfData.add(l.profWeek);
    }

    const priorWeeksLoads = allLoads.filter((l) => {
      // Always exclude loads with no real financials (see isRealLoad)
      if (!isRealLoad(l)) return false;
      if (l.profWeek && l.profWeek < targetMondayKey && l.profWeek >= fourWeeksBeforeKey) return true;
      if (!l.profWeek) {
        // No profWeek — apply status filter (profWeek loads already passed Tai's status filter)
        if (EXCLUDED_STATUSES.includes((l.status || "").toLowerCase())) return false;
        if (!l.pickupDate) return false;
        const weekKey = weekKeyOfPickup(l.pickupDate);
        if (weekKey >= targetMondayKey) return false;
        if (weekKey < fourWeeksBeforeKey) return false;
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
      const weekMon = l.profWeek || weekKeyOfPickup(l.pickupDate);
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
      sql: `SELECT salesRep, revenue, carrierCost, pickupDate, profWeek, status, lumperRevenue, lumperCost, carrier FROM Load`,
    });
    const recProfWeeks = new Set<string>();
    for (const r of recRes.rows) { const pw = r[4] as string | null; if (pw) recProfWeeks.add(pw); }
    const recByBroker: Record<string, Record<string, number>> = {};
    for (const r of recRes.rows) {
      const { broker, isActive } = resolveActiveBroker(roster, r[0] as string | null);
      if (!isActive) continue;
      const revenue = Number(r[1]) || 0;
      const carrierCost = Number(r[2]) || 0;
      if (!isRealLoad({ revenue, carrierCost, carrier: r[8] as string | null })) continue;
      const profWeek = r[4] as string | null;
      let wk: string;
      if (profWeek) wk = profWeek;
      else {
        if (EXCLUDED_STATUSES.includes(((r[5] as string) || "").toLowerCase())) continue;
        const pickup = r[3] as string | null;
        if (!pickup) continue;
        wk = weekKeyOfPickup(pickup);
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
      // hireDate is already a YYYY-MM-DD calendar date; compare it to the
      // Sunday that closes each completed week. Shifting the hire date itself
      // back to a Monday would drop the hire week.
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

      const ramp = getRampStatus(roster, broker, targetMonday);
      const rampWeeksLeft = ramp.ramping ? ramp.rampWeeks - ramp.weeksIn : 0;
      // The goal turns on the Monday `rampWeeksLeft` weeks after this one (each
      // Monday advances totalWeeks by 1). Same YYYY-MM-DD key as weekStart.
      // Brokers always start Mondays.
      let goalStartDate: string | null = null;
      if (ramp.ramping) {
        goalStartDate = addDays(targetMondayKey, rampWeeksLeft * 7);
      }

      return {
        broker,
        weeklyGoal,
        ramping: ramp.ramping,
        rampWeeksLeft,
        goalStartDate,
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
      period,
      periodStart: targetMondayKey,
      periodEnd: weekEndKey(targetMondayKey),
      periodLabel: "Weekly",
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
