"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Trophy } from "lucide-react";
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
import RangePicker, { toQuery, type RangeSelection } from "@/components/range-picker";
import CustomerBookPanel, { type CustomerEntry } from "@/components/customer-book-panel";
import { DEFAULT_PRESET } from "@/lib/date-ranges";
import { fmtK, fmtMoney } from "@/lib/format";

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
  range: { preset: string; label: string; from: string; to: string };
  periodSummary: { loads: number; revenue: number; margin: number; customersRan: number };
  customers: { active: CustomerEntry[]; dormant: CustomerEntry[]; dormantDays: number };
  weeklyData: WeeklyPoint[];
  topLanes: { lane: string; loads: number; margin: number }[];
  topCarriers: { carrier: string; loads: number; margin: number }[];
  recordWeek: { weekKey: string; weekLabel: string; margin: number; loads: number } | null;
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
      <p className="text-emerald-400 font-bold">{fmtMoney(d.margin)}</p>
      {d.goal > 0 && <p className="text-slate-500 text-xs mt-0.5">Goal: {fmtMoney(d.goal)}</p>}
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
  // Default preset is shared with the server so the chip can never label a
  // period the data doesn't actually cover.
  const [range, setRange] = useState<RangeSelection>({ preset: DEFAULT_PRESET });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/broker/history?broker=${encodeURIComponent(name)}&weeks=${weeks}&${toQuery(range)}`,
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
  }, [name, weeks, range]);

  useEffect(() => { load(); }, [load]);

  const allWeeks = data?.weeklyData ?? [];
  const completedWeeks = allWeeks.filter((w) => !w.isCurrent);
  const currentWeek = allWeeks.find((w) => w.isCurrent);
  const avgWeeklyMargin =
    completedWeeks.length > 0
      ? completedWeeks.reduce((s, w) => s + w.margin, 0) / completedWeeks.length
      : 0;

  const period = data?.periodSummary;
  const rangeLabel = data?.range.label ?? "this month";
  const periodMarginPct =
    period && period.revenue > 0 ? (period.margin / period.revenue) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
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
      </header>

      <div className="flex-1 px-4 sm:px-8 py-6 space-y-6 overflow-auto">
        {/* Broker name + the period control */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{name}</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {data ? (
                <>
                  {data.range.label}
                  <span className="text-slate-700"> · {data.range.from} → {data.range.to}</span>
                </>
              ) : (
                "Loading…"
              )}
            </p>
          </div>
          <RangePicker value={range} onChange={setRange} />
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
            {/* Period KPIs — these follow the range picker */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
                <p className="text-xs text-emerald-400/80 uppercase tracking-wider mb-1">Margin</p>
                <p className="text-xl font-bold text-emerald-400 tabular-nums">
                  {fmtMoney(period!.margin)}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">{rangeLabel}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Loads</p>
                <p className="text-xl font-bold text-white tabular-nums">{period!.loads}</p>
                <p className="text-xs text-slate-600 mt-0.5">{fmtMoney(period!.revenue)} revenue</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Margin %</p>
                <p className="text-xl font-bold text-white tabular-nums">
                  {period!.loads > 0 ? `${periodMarginPct.toFixed(1)}%` : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Customers Ran</p>
                <p className="text-xl font-bold text-white tabular-nums">{period!.customersRan}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  of {data.customers.active.length} active
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
                <p className="text-xs text-amber-400/90 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Trophy className="w-3 h-3" /> Record Week
                </p>
                {data.recordWeek ? (
                  <>
                    <p className="text-xl font-bold text-amber-300 tabular-nums">
                      {fmtMoney(data.recordWeek.margin)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      week of {data.recordWeek.weekLabel}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xl font-bold text-slate-600">—</p>
                    <p className="text-xs text-slate-600 mt-0.5">no completed weeks yet</p>
                  </>
                )}
              </div>
            </div>

            {/* Book of business */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-base font-semibold text-white">Customers</h2>
                <p className="text-xs text-slate-600">
                  Dollar figures follow the selected period · click a customer for detail
                </p>
              </div>
              <CustomerBookPanel
                active={data.customers.active}
                dormant={data.customers.dormant}
                dormantDays={data.customers.dormantDays}
                rangeLabel={data.range.label}
                hrefFor={(customer) =>
                  `/broker/${encodeURIComponent(name)}/customer/${encodeURIComponent(customer)}?${toQuery(range)}`
                }
              />
            </div>

            {/* Weekly trend — its own trailing window, independent of the range */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Weekly trend</h2>
                  <p className="text-xs text-slate-600">
                    Trailing {weeks} weeks — not affected by the period above
                  </p>
                </div>
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
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="flex items-baseline justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-300">Weekly Gross Margin</h3>
                    <span className="text-xs text-slate-600">
                      avg {fmtMoney(avgWeeklyMargin)} · {completedWeeks.length} wks
                    </span>
                  </div>
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
                        <Bar dataKey="margin" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false}>
                          {allWeeks.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={
                                entry.goal > 0 && entry.margin < entry.goal * 0.85 && !entry.isCurrent
                                  ? "#ef4444"
                                  : entry.isCurrent
                                  ? "#34d399"
                                  : "#10b981"
                              }
                              opacity={entry.isCurrent ? 0.7 : 1}
                            />
                          ))}
                        </Bar>
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

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-4">Loads Per Week</h3>
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
                        <Bar dataKey="loads" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false}>
                          {allWeeks.map((entry, index) => (
                            <Cell key={index} fill="#3b82f6" opacity={entry.isCurrent ? 0.6 : 0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Lanes + carriers — these follow the range */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-1">Top Lanes</h2>
                <p className="text-xs text-slate-600 mb-3">{data.range.label}</p>
                {data.topLanes.length === 0 ? (
                  <p className="text-slate-600 text-sm">No loads in this period</p>
                ) : (
                  <div className="space-y-2">
                    {data.topLanes.map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-600 text-xs font-mono w-4 shrink-0">{i + 1}</span>
                          <span className="text-sm text-slate-300 truncate">{l.lane}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold text-emerald-400">{fmtMoney(l.margin)}</span>
                          <span className="text-xs text-slate-600 ml-2">{l.loads} loads</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-slate-300 mb-1">Top Carriers</h2>
                <p className="text-xs text-slate-600 mb-3">{data.range.label}</p>
                {data.topCarriers.length === 0 ? (
                  <p className="text-slate-600 text-sm">No loads in this period</p>
                ) : (
                  <div className="space-y-2">
                    {data.topCarriers.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-600 text-xs font-mono w-4 shrink-0">{i + 1}</span>
                          <span className="text-sm text-slate-300 truncate">{c.carrier}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold text-emerald-400">{fmtMoney(c.margin)}</span>
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
