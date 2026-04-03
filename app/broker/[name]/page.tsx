"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface WeeklyPoint {
  weekKey: string;
  weekLabel: string;
  loads: number;
  revenue: number;
  margin: number;
  goal: number;
  isCurrent: boolean;
}

interface BrokerHistory {
  broker: string;
  weeklyData: WeeklyPoint[];
  topLanes: { lane: string; loads: number; margin: number }[];
  topCarriers: { carrier: string; loads: number; margin: number }[];
}

function fmt(n: number, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtK(n: number) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return fmt(n);
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: WeeklyPoint }>;
  label?: string;
}

function MarginTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="text-slate-400 mb-1">{d.weekLabel}{d.isCurrent ? " (current)" : ""}</p>
      <p className="text-emerald-400 font-bold">{fmt(d.margin)}</p>
      {d.goal > 0 && (
        <p className="text-slate-500 text-xs mt-0.5">Goal: {fmt(d.goal)}</p>
      )}
    </div>
  );
}

function LoadsTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="text-slate-400 mb-1">{d.weekLabel}{d.isCurrent ? " (current)" : ""}</p>
      <p className="text-blue-400 font-bold">{d.loads} loads</p>
    </div>
  );
}

export default function BrokerDrilldownPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);

  const [data, setData] = useState<BrokerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(12);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/broker/history?broker=${encodeURIComponent(name)}&weeks=${weeks}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }
  }, [name, weeks]);

  useEffect(() => { load(); }, [load]);

  // Summary stats from weekly data
  const allWeeks = data?.weeklyData ?? [];
  const completedWeeks = allWeeks.filter((w) => !w.isCurrent);
  const currentWeek = allWeeks.find((w) => w.isCurrent);
  const totalMargin = allWeeks.reduce((s, w) => s + w.margin, 0);
  const totalLoads = allWeeks.reduce((s, w) => s + w.loads, 0);
  const avgWeeklyMargin =
    completedWeeks.length > 0
      ? completedWeeks.reduce((s, w) => s + w.margin, 0) / completedWeeks.length
      : 0;

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-5 border-b border-white/[0.08] bg-[#0a0e17]">
        <div className="flex items-center gap-4">
          <Link
            href="/leaderboard"
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Leaderboard</span>
          </Link>
          <div className="w-px h-6 bg-white/10" />
          <div>
            <Image src="/oath-logo-white.png" alt="Oath Logistics" width={110} height={43} priority />
            <p className="text-slate-500 text-xs mt-0.5 uppercase tracking-widest">My Dashboard</p>
          </div>
        </div>

        {/* Week range selector */}
        <div className="flex items-center gap-2">
          {[8, 12, 26].map((w) => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                weeks === w
                  ? "bg-white/10 border-white/20 text-white"
                  : "border-white/[0.06] text-slate-500 hover:text-slate-300 hover:border-white/10"
              }`}
            >
              {w}w
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 px-4 sm:px-8 py-6 space-y-6 overflow-auto">
        {/* Broker name */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{name}</h1>
          <p className="text-slate-500 text-sm mt-0.5">Last {weeks} weeks</p>
        </div>

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
              Loading your data…
            </div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">This Week</p>
                <p className="text-xl font-bold text-emerald-400">
                  {currentWeek ? fmt(currentWeek.margin) : "—"}
                </p>
                {currentWeek?.goal ? (
                  <p className="text-xs text-slate-600 mt-0.5">
                    Goal: {fmt(currentWeek.goal)} · {Math.round((currentWeek.margin / currentWeek.goal) * 100)}%
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Avg / Week</p>
                <p className="text-xl font-bold text-white">{fmt(avgWeeklyMargin)}</p>
                <p className="text-xs text-slate-600 mt-0.5">{completedWeeks.length} completed weeks</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Total Margin</p>
                <p className="text-xl font-bold text-white">{fmt(totalMargin)}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Total Loads</p>
                <p className="text-xl font-bold text-white">{totalLoads}</p>
              </div>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Weekly Margin chart */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">Weekly Gross Margin</h2>
                {allWeeks.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-slate-600 text-sm">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={allWeeks} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="weekLabel"
                        tick={{ fill: "#475569", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fill: "#475569", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={fmtK}
                        width={44}
                      />
                      <Tooltip content={<MarginTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      {/* Goal reference lines per week — rendered as individual bars via goal data */}
                      <Bar dataKey="margin" radius={[3, 3, 0, 0]} maxBarSize={32}>
                        {allWeeks.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={
                              entry.isCurrent
                                ? "#34d399"
                                : entry.goal > 0 && entry.margin >= entry.goal
                                ? "#10b981"
                                : entry.goal > 0 && entry.margin < entry.goal * 0.85
                                ? "#ef4444"
                                : "#10b981"
                            }
                            opacity={entry.isCurrent ? 0.7 : 1}
                          />
                        ))}
                      </Bar>
                      {/* Show a single goal reference line at the current week's goal level if it exists */}
                      {currentWeek?.goal ? (
                        <ReferenceLine
                          y={currentWeek.goal}
                          stroke="#facc15"
                          strokeDasharray="4 4"
                          strokeWidth={1.5}
                          label={{ value: "Goal", fill: "#facc15", fontSize: 10, position: "insideTopRight" }}
                        />
                      ) : null}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Weekly Loads chart */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">Loads Per Week</h2>
                {allWeeks.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-slate-600 text-sm">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={allWeeks} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="weekLabel"
                        tick={{ fill: "#475569", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: "#475569", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <Tooltip content={<LoadsTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="loads" radius={[3, 3, 0, 0]} maxBarSize={32}>
                        {allWeeks.map((entry, index) => (
                          <Cell
                            key={index}
                            fill="#3b82f6"
                            opacity={entry.isCurrent ? 0.6 : 0.8}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Top Lanes + Top Carriers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Lanes */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">Top Lanes</h2>
                {data.topLanes.length === 0 ? (
                  <p className="text-slate-600 text-sm">No data</p>
                ) : (
                  <div className="space-y-2">
                    {data.topLanes.map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-600 text-xs font-mono w-4 shrink-0">{i + 1}</span>
                          <span className="text-sm text-slate-300 truncate">{l.lane}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold text-emerald-400">{fmt(l.margin)}</span>
                          <span className="text-xs text-slate-600 ml-2">{l.loads} loads</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top Carriers */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">Top Carriers</h2>
                {data.topCarriers.length === 0 ? (
                  <p className="text-slate-600 text-sm">No data</p>
                ) : (
                  <div className="space-y-2">
                    {data.topCarriers.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-600 text-xs font-mono w-4 shrink-0">{i + 1}</span>
                          <span className="text-sm text-slate-300 truncate">{c.carrier}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold text-emerald-400">{fmt(c.margin)}</span>
                          <span className="text-xs text-slate-600 ml-2">{c.loads} loads</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
