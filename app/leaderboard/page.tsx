"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

interface BrokerRow {
  broker: string;
  weeklyGoal: number;
  current: { loads: number; revenue: number; margin: number; avgPerLoad: number; marginPct: number };
  rolling4wAvg: { loads: number; margin: number };
  goalPct: number | null;
  paceStatus: "ahead" | "on_pace" | "behind" | "no_goal";
  pacedGoal: number;
  marginDelta: number | null;
}

interface LeaderboardData {
  weekStart: string;
  updatedAt: string;
  paceFactor: number;
  brokers: BrokerRow[];
}

function fmt(n: number, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
}

function weekRangeLabel(weekStart: string) {
  const start = new Date(weekStart + "T12:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function PaceChip({ status }: { status: BrokerRow["paceStatus"] }) {
  const cfg = {
    ahead:    { label: "Ahead",    cls: "bg-emerald-900/50 text-emerald-300 border-emerald-700/40" },
    on_pace:  { label: "On Pace",  cls: "bg-yellow-900/50 text-yellow-300 border-yellow-700/40" },
    behind:   { label: "Behind",   cls: "bg-red-900/50 text-red-300 border-red-700/40" },
    no_goal:  { label: "Ahead",    cls: "bg-emerald-900/50 text-emerald-300 border-emerald-700/40" },
  }[status];
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-slate-600 text-sm">—</span>;
  const pos = delta >= 0;
  return (
    <span className={`text-sm font-semibold tabular-nums ${pos ? "text-emerald-400" : "text-red-400"}`}>
      {pos ? "▲" : "▼"} {pos ? "+" : ""}{fmt(delta, 0)}
    </span>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tick, setTick] = useState(0); // for countdown

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (res.ok) { setData(await res.json()); setLastRefresh(new Date()); }
    } catch { /* retry next interval */ }
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(load, 60_000);
    const counter = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(refresh); clearInterval(counter); };
  }, [load]);

  const activeRows = data?.brokers.filter((b) => b.current.loads > 0) ?? [];
  const idleRows = data?.brokers.filter((b) => b.current.loads === 0) ?? [];

  const totals = activeRows.reduce(
    (acc, b) => ({ loads: acc.loads + b.current.loads, revenue: acc.revenue + b.current.revenue, margin: acc.margin + b.current.margin }),
    { loads: 0, revenue: 0, margin: 0 }
  );

  // Seconds until next refresh
  const secSinceRefresh = lastRefresh ? Math.floor((Date.now() - lastRefresh.getTime()) / 1000) : 0;
  const secUntilNext = Math.max(60 - secSinceRefresh, 0);

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/[0.08] bg-[#0a0e17]">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="w-px h-6 bg-white/10" />
          <div>
            <Image src="/oath-logo-white.png" alt="Oath Logistics" width={130} height={51} priority />
            <p className="text-slate-500 text-xs mt-0.5 uppercase tracking-widest">Weekly Leaderboard</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Totals summary */}
          {data && (
            <div className="hidden sm:flex items-center gap-6 pr-6 border-r border-white/10">
              <div className="text-right">
                <p className="text-xs text-slate-600 uppercase tracking-wider">Total Loads</p>
                <p className="text-xl font-bold text-white">{totals.loads}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-600 uppercase tracking-wider">Revenue</p>
                <p className="text-xl font-bold text-white">{fmt(totals.revenue)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-600 uppercase tracking-wider">Gross Margin</p>
                <p className="text-xl font-bold text-emerald-400">{fmt(totals.margin, 2)}</p>
              </div>
            </div>
          )}

          {/* Date + refresh */}
          <div className="text-right">
            <p className="text-base font-semibold text-slate-200">
              {data ? weekRangeLabel(data.weekStart) : "—"}
            </p>
            <div className="flex items-center justify-end gap-2 mt-0.5">
              {/* Live dot */}
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <p className="text-xs text-slate-500">
                Live · refreshes in {secUntilNext}s
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Table */}
      <div className="flex-1 px-8 py-6 overflow-auto">
        {!data ? (
          <div className="flex items-center justify-center h-64 text-slate-600 text-lg">Loading…</div>
        ) : (
          <>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-slate-600 border-b border-white/[0.06]">
                  <th className="text-left py-3 pr-4 w-10">#</th>
                  <th className="text-left py-3 pr-4 min-w-[140px]">Broker</th>
                  <th className="text-right py-3 px-3">Loads</th>
                  <th className="text-right py-3 px-3">Revenue</th>
                  <th className="text-right py-3 px-3">Gross Margin</th>
                  <th className="text-right py-3 px-3">Margin %</th>
                  <th className="text-right py-3 px-3">Avg / Load</th>
                  <th className="text-right py-3 px-3 border-l border-white/[0.06]">4-Wk Avg</th>
                  <th className="text-right py-3 pl-3">vs Avg</th>
                  <th className="text-left py-3 pl-6 min-w-[220px]">Goal Progress</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((b, i) => {
                  const isTop3 = i < 3;
                  const goalBarWidth = b.goalPct !== null ? Math.min(b.goalPct, 100) : 0;
                  const goalColor = (b.goalPct ?? 0) >= 100 ? "bg-emerald-400"
                    : (b.goalPct ?? 0) >= 70 ? "bg-yellow-400"
                    : "bg-red-500";

                  return (
                    <tr
                      key={b.broker}
                      className={`border-b border-white/[0.04] transition-colors ${isTop3 ? "bg-white/[0.015]" : ""}`}
                    >
                      {/* Rank */}
                      <td className="py-4 pr-4">
                        {i < 3
                          ? <span className="text-3xl">{MEDALS[i]}</span>
                          : <span className="text-slate-600 text-sm font-mono">{i + 1}</span>
                        }
                      </td>

                      {/* Broker */}
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-bold whitespace-nowrap ${isTop3 ? "text-xl text-white" : "text-lg text-slate-200"}`}>
                            {b.broker}
                          </span>
                          <PaceChip status={b.paceStatus} />
                        </div>
                      </td>

                      {/* Loads */}
                      <td className="py-4 px-3 text-right">
                        <span className={`font-bold tabular-nums ${isTop3 ? "text-xl text-white" : "text-lg text-slate-300"}`}>
                          {b.current.loads}
                        </span>
                      </td>

                      {/* Revenue */}
                      <td className="py-4 px-3 text-right">
                        <span className={`tabular-nums ${isTop3 ? "text-lg text-slate-200" : "text-base text-slate-400"}`}>
                          {fmt(b.current.revenue)}
                        </span>
                      </td>

                      {/* Gross Margin */}
                      <td className="py-4 px-3 text-right">
                        <span className={`font-bold tabular-nums ${
                          b.current.margin >= 0
                            ? isTop3 ? "text-xl text-emerald-400" : "text-lg text-emerald-500"
                            : "text-lg text-red-400"
                        }`}>
                          {fmt(b.current.margin, 2)}
                        </span>
                      </td>

                      {/* Margin % */}
                      <td className="py-4 px-3 text-right">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          b.current.marginPct >= 10 ? "bg-emerald-900/50 text-emerald-300"
                            : b.current.marginPct >= 5 ? "bg-yellow-900/50 text-yellow-300"
                            : "bg-red-900/50 text-red-300"
                        }`}>
                          {b.current.marginPct.toFixed(1)}%
                        </span>
                      </td>

                      {/* Avg / load */}
                      <td className="py-4 px-3 text-right">
                        <span className={`tabular-nums ${isTop3 ? "text-lg text-slate-200" : "text-base text-slate-400"}`}>
                          {fmt(b.current.avgPerLoad, 2)}
                        </span>
                      </td>

                      {/* 4-wk avg */}
                      <td className="py-4 px-3 text-right border-l border-white/[0.06]">
                        <span className="text-base text-slate-500 tabular-nums">
                          {b.rolling4wAvg.margin > 0 ? fmt(b.rolling4wAvg.margin) : "—"}
                        </span>
                      </td>

                      {/* Delta vs avg */}
                      <td className="py-4 pl-3 text-right">
                        <DeltaBadge delta={b.marginDelta} />
                      </td>

                      {/* Goal progress */}
                      <td className="py-4 pl-6">
                        {b.weeklyGoal > 0 ? (
                          <div className="min-w-[180px]">
                            <div className="flex justify-between items-baseline mb-1.5">
                              <span className="text-xs text-slate-400 tabular-nums font-medium">{fmt(b.current.margin)}</span>
                              <span className={`text-sm font-bold tabular-nums ${
                                (b.goalPct ?? 0) >= 100 ? "text-emerald-400"
                                  : (b.goalPct ?? 0) >= 70 ? "text-yellow-400"
                                  : "text-red-400"
                              }`}>
                                {b.goalPct !== null ? `${Math.round(b.goalPct)}%` : ""}
                              </span>
                            </div>
                            <div className="h-3 bg-white/[0.08] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${goalColor}`}
                                style={{ width: `${goalBarWidth}%` }}
                              />
                            </div>
                            <p className="text-xs text-white/70 mt-1.5 text-right">
                              goal: {fmt(b.weeklyGoal)}
                            </p>
                          </div>
                        ) : (
                          <div className="min-w-[180px]">
                            <div className="flex justify-between items-baseline mb-1.5">
                              <span className="text-xs text-slate-400 tabular-nums font-medium">{fmt(b.current.margin)}</span>
                              <span className="text-sm font-bold tabular-nums text-emerald-400">100%</span>
                            </div>
                            <div className="h-3 bg-white/[0.08] rounded-full overflow-hidden">
                              <div className="h-full w-full rounded-full bg-emerald-400 transition-all duration-700" />
                            </div>
                            <p className="text-xs text-white/70 mt-1.5 text-right">ramping up</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Idle brokers (0 loads this week) */}
            {idleRows.length > 0 && (
              <div className="mt-6 border-t border-white/[0.05] pt-4">
                <p className="text-xs text-slate-700 uppercase tracking-widest mb-3">No loads yet this week</p>
                <div className="flex flex-wrap gap-3">
                  {idleRows.map((b) => (
                    <div key={b.broker} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                      <span className="text-sm text-slate-600 font-medium">{b.broker}</span>
                      {b.weeklyGoal > 0 && (
                        <span className="text-xs text-slate-700">Goal: {fmt(b.weeklyGoal)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
