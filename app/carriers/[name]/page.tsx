"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ExternalLink, Truck } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

interface WeeklyPoint {
  weekKey: string;
  weekLabel: string;
  loads: number;
  spend: number;
  margin: number;
  isCurrent: boolean;
}

interface CarrierProfile {
  carrier: string;
  totalLoads: number;
  totalSpend: number;
  totalMargin: number;
  avgCostPerLoad: number;
  avgMarginPerLoad: number;
  states: string[];
  weeklyTrend: WeeklyPoint[];
  topLanes: { lane: string; loads: number; spend: number; margin: number; avgCost: number }[];
  brokerBreakdown: { broker: string; loads: number; spend: number; margin: number }[];
  recentLoads: { loadNumber: string; date: string; origin: string; destination: string; spend: number; margin: number; broker: string }[];
  highwaySearchUrl: string;
}

function fmt(n: number, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
}

function fmtK(n: number) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return fmt(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SpendTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: WeeklyPoint = payload[0].payload;
  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="text-slate-400 mb-1">{d.weekLabel}{d.isCurrent ? " (current)" : ""}</p>
      <p className="text-blue-400 font-bold">{fmt(d.spend)} spend</p>
      <p className="text-emerald-400 text-xs mt-0.5">{fmt(d.margin)} margin</p>
      <p className="text-slate-500 text-xs">{d.loads} loads</p>
    </div>
  );
}

export default function CarrierProfilePage() {
  const params = useParams();
  const router = useRouter();
  const carrierName = decodeURIComponent(params.name as string);

  const [data, setData] = useState<CarrierProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(12);
  const [activeTab, setActiveTab] = useState<"overview" | "lanes" | "loads">("overview");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/carriers/${encodeURIComponent(carrierName)}?weeks=${weeks}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load carrier data");
    }
  }, [carrierName, weeks]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-5 border-b border-white/[0.08] bg-[#0a0e17]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="w-px h-6 bg-white/10" />
          <div>
            <Image src="/oath-logo-white.png" alt="Oath Logistics" width={110} height={43} priority />
            <p className="text-slate-500 text-xs mt-0.5 uppercase tracking-widest">Carrier Profile</p>
          </div>
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
      </header>

      <div className="flex-1 px-4 sm:px-8 py-6 space-y-6 overflow-auto">
        {/* Carrier name + Highway button */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-900/30 border border-blue-700/30 flex items-center justify-center flex-shrink-0">
              <Truck className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{carrierName}</h1>
              {data && (
                <p className="text-slate-500 text-sm mt-0.5">
                  {data.states.length} states · {weeks}w window
                </p>
              )}
            </div>
          </div>
          {data && (
            <a
              href={data.highwaySearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 hover:border-yellow-500/50 transition-all text-sm font-semibold"
            >
              <ExternalLink className="w-4 h-4" />
              Highway Profile
            </a>
          )}
        </div>

        {error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <p className="text-red-400">{error}</p>
            <button onClick={load} className="text-sm text-slate-400 hover:text-white border border-white/10 px-4 py-2 rounded-lg transition-colors">Retry</button>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-slate-500">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-600 border-t-slate-400 rounded-full" />
              Loading carrier data…
            </div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "Total Loads", value: data.totalLoads.toString(), color: "text-white" },
                { label: "Total Spend", value: fmt(data.totalSpend), color: "text-blue-400" },
                { label: "Avg Cost / Load", value: fmt(data.avgCostPerLoad), color: "text-slate-200" },
                { label: "Margin Generated", value: fmt(data.totalMargin), color: "text-emerald-400" },
                { label: "Avg Margin / Load", value: fmt(data.avgMarginPerLoad), color: "text-emerald-400" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* States */}
            {data.states.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.states.map((s) => (
                  <span key={s} className="text-xs px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] text-slate-400">{s}</span>
                ))}
              </div>
            )}

            {/* Weekly spend chart */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-4">Weekly Spend & Margin</h2>
              {data.weeklyTrend.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-600 text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.weeklyTrend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtK} width={44} />
                    <Tooltip content={<SpendTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <Bar dataKey="spend" radius={[3, 3, 0, 0]} maxBarSize={32}>
                      {data.weeklyTrend.map((entry, i) => (
                        <Cell key={i} fill="#3b82f6" opacity={entry.isCurrent ? 0.6 : 0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/[0.06]">
              {(["overview", "lanes", "loads"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors capitalize ${
                    activeTab === tab
                      ? "text-white border-b-2 border-blue-500"
                      : "text-slate-600 hover:text-slate-400"
                  }`}
                >
                  {tab === "overview" ? "Broker Breakdown" : tab === "lanes" ? "Top Lanes" : "Recent Loads"}
                </button>
              ))}
            </div>

            {/* Tab: Broker Breakdown */}
            {activeTab === "overview" && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-slate-600 border-b border-white/[0.06]">
                      <th className="text-left px-4 py-3">Broker</th>
                      <th className="text-right px-4 py-3">Loads</th>
                      <th className="text-right px-4 py-3">Spend</th>
                      <th className="text-right px-4 py-3">Margin</th>
                      <th className="text-right px-4 py-3">Avg Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.brokerBreakdown.map((b) => (
                      <tr key={b.broker} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-slate-200">{b.broker}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-300">{b.loads}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-blue-400">{fmt(b.spend)}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-emerald-400">{fmt(b.margin)}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-400">{fmt(b.loads > 0 ? b.spend / b.loads : 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab: Top Lanes */}
            {activeTab === "lanes" && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-slate-600 border-b border-white/[0.06]">
                      <th className="text-left px-4 py-3">#</th>
                      <th className="text-left px-4 py-3">Lane</th>
                      <th className="text-right px-4 py-3">Loads</th>
                      <th className="text-right px-4 py-3">Total Spend</th>
                      <th className="text-right px-4 py-3">Avg Cost</th>
                      <th className="text-right px-4 py-3">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topLanes.map((l, i) => (
                      <tr key={l.lane} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-slate-600 text-xs font-mono">{i + 1}</td>
                        <td className="px-4 py-3 text-sm text-slate-200 max-w-xs truncate">{l.lane}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-300">{l.loads}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-blue-400">{fmt(l.spend)}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-400">{fmt(l.avgCost)}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-emerald-400">{fmt(l.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab: Recent Loads */}
            {activeTab === "loads" && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-slate-600 border-b border-white/[0.06]">
                      <th className="text-left px-4 py-3">Load #</th>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">Origin</th>
                      <th className="text-left px-4 py-3">Destination</th>
                      <th className="text-right px-4 py-3">Cost</th>
                      <th className="text-right px-4 py-3">Margin</th>
                      <th className="text-left px-4 py-3">Broker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLoads.map((l) => (
                      <tr key={l.loadNumber} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-xs font-mono text-slate-500">{l.loadNumber}</td>
                        <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">{fmtDate(l.date)}</td>
                        <td className="px-4 py-3 text-sm text-slate-300 max-w-[140px] truncate">{l.origin}</td>
                        <td className="px-4 py-3 text-sm text-slate-300 max-w-[140px] truncate">{l.destination}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-blue-400">{fmt(l.spend)}</td>
                        <td className={`px-4 py-3 text-right text-sm tabular-nums font-semibold ${l.margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(l.margin)}</td>
                        <td className="px-4 py-3 text-sm text-slate-400">{l.broker}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
