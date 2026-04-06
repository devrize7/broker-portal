"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Search, ChevronUp, ChevronDown } from "lucide-react";

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

type SortKey = "margin" | "loads" | "revenue" | "marginPct" | "avgPerLoad" | "goalPct";
type SortDir = "asc" | "desc";

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
    ahead:   { label: "Ahead",   cls: "bg-emerald-900/50 text-emerald-300 border-emerald-700/40" },
    on_pace: { label: "On Pace", cls: "bg-yellow-900/50 text-yellow-300 border-yellow-700/40" },
    behind:  { label: "Behind",  cls: "bg-red-900/50 text-red-300 border-red-700/40" },
    no_goal: { label: "Ahead",   cls: "bg-emerald-900/50 text-emerald-300 border-emerald-700/40" },
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

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <ChevronUp className="w-3 h-3 text-slate-700 inline ml-0.5" />;
  return dir === "desc"
    ? <ChevronDown className="w-3 h-3 text-slate-400 inline ml-0.5" />
    : <ChevronUp className="w-3 h-3 text-slate-400 inline ml-0.5" />;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function sortBrokers(rows: BrokerRow[], key: SortKey, dir: SortDir): BrokerRow[] {
  return [...rows].sort((a, b) => {
    let av = 0, bv = 0;
    switch (key) {
      case "margin":     av = a.current.margin;    bv = b.current.margin;    break;
      case "loads":      av = a.current.loads;     bv = b.current.loads;     break;
      case "revenue":    av = a.current.revenue;   bv = b.current.revenue;   break;
      case "marginPct":  av = a.current.marginPct; bv = b.current.marginPct; break;
      case "avgPerLoad": av = a.current.avgPerLoad; bv = b.current.avgPerLoad; break;
      case "goalPct":    av = a.goalPct ?? 0;       bv = b.goalPct ?? 0;      break;
    }
    return dir === "desc" ? bv - av : av - bv;
  });
}

export default function LeaderboardPage() {
  const { data: session } = useSession();
  const sessionUser = session?.user as { brokerName?: string | null; isAdmin?: boolean } | undefined;
  const myBrokerName = sessionUser?.brokerName ?? null;
  const isAdmin = sessionUser?.isAdmin ?? false;

  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("margin");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [weekOffset, setWeekOffset] = useState(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/leaderboard?week=${weekOffset}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setData(await res.json());
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leaderboard");
    }
  }, [weekOffset]);

  useEffect(() => {
    load();
    const refresh = weekOffset === 0 ? setInterval(load, 60_000) : null;
    const counter = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (refresh) clearInterval(refresh); clearInterval(counter); };
  }, [load, weekOffset]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const query = search.toLowerCase().trim();

  const activeRows = (data?.brokers.filter((b) => b.current.loads > 0) ?? [])
    .filter((b) => !query || b.broker.toLowerCase().includes(query));

  const idleRows = (data?.brokers.filter((b) => b.current.loads === 0) ?? [])
    .filter((b) => !query || b.broker.toLowerCase().includes(query));

  const sortedActive = sortBrokers(activeRows, sortKey, sortDir);

  const totals = (data?.brokers.filter((b) => b.current.loads > 0) ?? []).reduce(
    (acc, b) => ({ loads: acc.loads + b.current.loads, revenue: acc.revenue + b.current.revenue, margin: acc.margin + b.current.margin }),
    { loads: 0, revenue: 0, margin: 0 }
  );

  const secSinceRefresh = lastRefresh ? Math.floor((Date.now() - lastRefresh.getTime()) / 1000) : 0;
  const secUntilNext = Math.max(60 - secSinceRefresh, 0);

  function thCls(key: SortKey) {
    return `cursor-pointer select-none hover:text-slate-400 transition-colors ${sortKey === key ? "text-slate-400" : "text-slate-600"}`;
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-5 border-b border-white/[0.08] bg-[#0a0e17]">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="w-px h-6 bg-white/10" />
          <div>
            <Image src="/oath-logo-white.png" alt="Oath Logistics" width={110} height={43} priority />
            <p className="text-slate-500 text-xs mt-0.5 uppercase tracking-widest">Weekly Leaderboard</p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          {/* Totals summary — hidden on small screens */}
          {data && (
            <div className="hidden md:flex items-center gap-4 lg:gap-6 pr-4 lg:pr-6 border-r border-white/10">
              <div className="text-right">
                <p className="text-xs text-slate-600 uppercase tracking-wider">Loads</p>
                <p className="text-lg lg:text-xl font-bold text-white">{totals.loads}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-600 uppercase tracking-wider">Revenue</p>
                <p className="text-lg lg:text-xl font-bold text-white">{fmt(totals.revenue)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-600 uppercase tracking-wider">Margin</p>
                <p className="text-lg lg:text-xl font-bold text-emerald-400">{fmt(totals.margin, 2)}</p>
              </div>
            </div>
          )}

          {/* My Stats + Sign out */}
          <div className="flex items-center gap-3">
            {myBrokerName ? (
              <Link
                href={`/broker/${encodeURIComponent(myBrokerName)}`}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                My Stats
              </Link>
            ) : isAdmin && data ? (
              <select
                onChange={(e) => { if (e.target.value) window.location.href = `/broker/${encodeURIComponent(e.target.value)}`; }}
                defaultValue=""
                className="text-sm px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-slate-300 focus:outline-none cursor-pointer"
              >
                <option value="" disabled>View broker…</option>
                {data.brokers.map((b) => (
                  <option key={b.broker} value={b.broker}>{b.broker}</option>
                ))}
              </select>
            ) : null}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Sign out
            </button>
          </div>

          {/* Week navigation + date */}
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setWeekOffset((w) => Math.max(w - 1, -5))}
                className="text-slate-500 hover:text-white transition-colors p-1"
                title="Previous week"
              >
                ‹
              </button>
              <p className="text-sm sm:text-base font-semibold text-slate-200 min-w-[160px]">
                {data ? weekRangeLabel(data.weekStart) : "—"}
              </p>
              <button
                onClick={() => setWeekOffset((w) => Math.min(w + 1, 0))}
                disabled={weekOffset >= 0}
                className={`p-1 transition-colors ${weekOffset >= 0 ? "text-slate-800 cursor-not-allowed" : "text-slate-500 hover:text-white"}`}
                title="Next week"
              >
                ›
              </button>
            </div>
            <div className="flex items-center justify-end gap-2 mt-0.5">
              {weekOffset === 0 ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <p className="text-xs text-slate-500">
                    {error ? "Error" : `Live · ${secUntilNext}s`}
                  </p>
                </>
              ) : (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  ← Back to this week
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Search bar */}
      <div className="px-4 sm:px-8 pt-4">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
          <input
            type="text"
            placeholder="Search broker…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 sm:px-8 py-4 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <p className="text-red-400 text-base">{error}</p>
            <button
              onClick={load}
              className="text-sm text-slate-400 hover:text-white border border-white/10 hover:border-white/20 px-4 py-2 rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-slate-500">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-600 border-t-slate-400 rounded-full" />
              Loading…
            </div>
          </div>
        ) : sortedActive.length === 0 && idleRows.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-slate-600">
            No brokers match &ldquo;{search}&rdquo;
          </div>
        ) : (
          <>
            {/* ── Desktop table ── */}
            <div className="hidden md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest border-b border-white/[0.06]">
                    <th className="text-left py-3 pr-4 w-10 text-slate-600">#</th>
                    <th className="text-left py-3 pr-4 min-w-[140px] text-slate-600">Broker</th>
                    <th className={`text-right py-3 px-3 ${thCls("loads")}`} onClick={() => handleSort("loads")}>
                      Loads <SortIcon col="loads" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={`text-right py-3 px-3 ${thCls("revenue")}`} onClick={() => handleSort("revenue")}>
                      Revenue <SortIcon col="revenue" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={`text-right py-3 px-3 ${thCls("margin")}`} onClick={() => handleSort("margin")}>
                      Gross Margin <SortIcon col="margin" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={`text-right py-3 px-3 ${thCls("marginPct")}`} onClick={() => handleSort("marginPct")}>
                      Margin % <SortIcon col="marginPct" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className={`text-right py-3 px-3 ${thCls("avgPerLoad")}`} onClick={() => handleSort("avgPerLoad")}>
                      Avg / Load <SortIcon col="avgPerLoad" sortKey={sortKey} dir={sortDir} />
                    </th>
                    <th className="text-right py-3 px-3 border-l border-white/[0.06] text-slate-600 text-[10px] uppercase tracking-widest">4-Wk Avg</th>
                    <th className="text-right py-3 pl-3 text-slate-600 text-[10px] uppercase tracking-widest">vs Avg</th>
                    <th className={`text-left py-3 pl-6 min-w-[220px] ${thCls("goalPct")}`} onClick={() => handleSort("goalPct")}>
                      Goal Progress <SortIcon col="goalPct" sortKey={sortKey} dir={sortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedActive.map((b, i) => {
                    const isTop3 = sortKey === "margin" && sortDir === "desc" && i < 3;
                    const goalBarWidth = b.goalPct !== null ? Math.min(b.goalPct, 100) : 0;
                    const goalColor = (b.goalPct ?? 0) >= 100 ? "bg-emerald-400"
                      : (b.goalPct ?? 0) >= 70 ? "bg-yellow-400"
                      : "bg-red-500";

                    return (
                      <tr
                        key={b.broker}
                        className={`border-b border-white/[0.04] transition-colors group ${isTop3 ? "bg-white/[0.015]" : "hover:bg-white/[0.02]"}`}
                      >
                        <td className="py-4 pr-4">
                          {isTop3
                            ? <span className="text-3xl">{MEDALS[i]}</span>
                            : <span className="text-slate-600 text-sm font-mono">{i + 1}</span>
                          }
                        </td>
                        <td className="py-4 pr-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-bold whitespace-nowrap ${isTop3 ? "text-xl text-white" : "text-lg text-slate-200"}`}>
                              {b.broker}
                            </span>
                            <PaceChip status={b.paceStatus} />
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <span className={`font-bold tabular-nums ${isTop3 ? "text-xl text-white" : "text-lg text-slate-300"}`}>
                            {b.current.loads}
                          </span>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <span className={`tabular-nums ${isTop3 ? "text-lg text-slate-200" : "text-base text-slate-400"}`}>
                            {fmt(b.current.revenue)}
                          </span>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <span className={`font-bold tabular-nums ${
                            b.current.margin >= 0
                              ? isTop3 ? "text-xl text-emerald-400" : "text-lg text-emerald-500"
                              : "text-lg text-red-400"
                          }`}>
                            {fmt(b.current.margin, 2)}
                          </span>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            b.current.marginPct >= 10 ? "bg-emerald-900/50 text-emerald-300"
                              : b.current.marginPct >= 5 ? "bg-yellow-900/50 text-yellow-300"
                              : "bg-red-900/50 text-red-300"
                          }`}>
                            {b.current.marginPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-4 px-3 text-right">
                          <span className={`tabular-nums ${isTop3 ? "text-lg text-slate-200" : "text-base text-slate-400"}`}>
                            {fmt(b.current.avgPerLoad, 2)}
                          </span>
                        </td>
                        <td className="py-4 px-3 text-right border-l border-white/[0.06]">
                          <span className="text-base text-slate-500 tabular-nums">
                            {b.rolling4wAvg.margin > 0 ? fmt(b.rolling4wAvg.margin) : "—"}
                          </span>
                        </td>
                        <td className="py-4 pl-3 text-right">
                          <DeltaBadge delta={b.marginDelta} />
                        </td>
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
                                <div className={`h-full rounded-full transition-all duration-700 ${goalColor}`} style={{ width: `${goalBarWidth}%` }} />
                              </div>
                              <p className="text-xs text-white/70 mt-1.5 text-right">goal: {fmt(b.weeklyGoal)}</p>
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
            </div>

            {/* ── Mobile card list ── */}
            <div className="md:hidden space-y-2">
              {sortedActive.map((b, i) => {
                const isTop3 = sortKey === "margin" && sortDir === "desc" && i < 3;
                const goalBarWidth = b.goalPct !== null ? Math.min(b.goalPct, 100) : 0;
                const goalColor = (b.goalPct ?? 0) >= 100 ? "bg-emerald-400"
                  : (b.goalPct ?? 0) >= 70 ? "bg-yellow-400"
                  : "bg-red-500";

                return (
                  <div
                    key={b.broker}
                    className={`rounded-xl border border-white/[0.06] p-4 ${isTop3 ? "bg-white/[0.025]" : "bg-white/[0.01]"}`}
                  >
                    {/* Top row: rank + name + pace */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {isTop3
                          ? <span className="text-2xl">{MEDALS[i]}</span>
                          : <span className="text-slate-600 text-sm font-mono w-5">{i + 1}</span>
                        }
                        <span className="font-bold text-white text-base">{b.broker}</span>
                        <PaceChip status={b.paceStatus} />
                      </div>
                    </div>

                    {/* Key metrics row */}
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Margin</p>
                        <p className={`font-bold tabular-nums text-base ${b.current.margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {fmt(b.current.margin)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Revenue</p>
                        <p className="text-slate-300 tabular-nums text-sm">{fmt(b.current.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Loads</p>
                        <p className="text-slate-300 font-bold tabular-nums text-sm">{b.current.loads}</p>
                      </div>
                    </div>

                    {/* Goal progress */}
                    {b.weeklyGoal > 0 ? (
                      <div>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-xs text-slate-500">Goal: {fmt(b.weeklyGoal)}</span>
                          <span className={`text-xs font-bold ${
                            (b.goalPct ?? 0) >= 100 ? "text-emerald-400"
                              : (b.goalPct ?? 0) >= 70 ? "text-yellow-400"
                              : "text-red-400"
                          }`}>
                            {b.goalPct !== null ? `${Math.round(b.goalPct)}%` : ""}
                          </span>
                        </div>
                        <div className="h-2 bg-white/[0.08] rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ${goalColor}`} style={{ width: `${goalBarWidth}%` }} />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-xs text-slate-500">Ramping up</span>
                          <span className="text-xs font-bold text-emerald-400">100%</span>
                        </div>
                        <div className="h-2 bg-white/[0.08] rounded-full overflow-hidden">
                          <div className="h-full w-full rounded-full bg-emerald-400" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Idle brokers */}
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
