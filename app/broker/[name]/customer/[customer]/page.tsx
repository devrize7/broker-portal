"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, MoonStar, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import RangePicker, { toQuery, type RangeSelection } from "@/components/range-picker";
import { DEFAULT_PRESET, isValidYmd, parsePreset } from "@/lib/date-ranges";
import { fmtDate, fmtGap, fmtK, fmtMoney } from "@/lib/format";

interface Summary {
  loads: number;
  revenue: number;
  margin: number;
  marginPct: number;
  avgPerLoad: number;
}

interface CustomerArDetail {
  totalOpen: number;
  invoiceCount: number;
  overdueTotal: number;
  overdueCount: number;
  oldestDaysOverdue: number;
  parkedTotal: number;
  seriouslyPastDue: boolean;
}

interface CustomerDetail {
  broker: string;
  customer: string;
  ar: CustomerArDetail | null;
  status: "active" | "dormant";
  dormantDays: number;
  lastLoadDate: string;
  daysSinceLastLoad: number;
  firstLoadDate: string;
  range: { preset: string; label: string; from: string; to: string };
  period: Summary;
  lifetime: Summary;
  monthlyTrend: { month: string; monthLabel: string; loads: number; revenue: number; margin: number }[];
  topLanes: { lane: string; loads: number; margin: number }[];
  topCarriers: { carrier: string; loads: number; margin: number }[];
  loads: {
    loadNumber: string;
    pickupDate: string;
    origin: string;
    destination: string;
    carrier: string;
    status: string;
    revenue: number;
    margin: number;
  }[];
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CustomerDetail["monthlyTrend"][number] }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="text-slate-400 mb-1">{d.monthLabel}</p>
      {d.loads === 0 ? (
        <p className="text-slate-500">No loads</p>
      ) : (
        <>
          <p className="text-emerald-400 font-bold">{fmtMoney(d.margin)}</p>
          <p className="text-slate-500 text-xs mt-0.5">{d.loads} loads</p>
        </>
      )}
    </div>
  );
}

export default function CustomerDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const broker = decodeURIComponent(params.name as string);
  const customer = decodeURIComponent(params.customer as string);

  // Carry the period through from the broker page so the drill-down opens on
  // the same window the user was already looking at.
  const [range, setRange] = useState<RangeSelection>(() => {
    const preset = parsePreset(searchParams.get("preset") ?? DEFAULT_PRESET);
    if (preset !== "custom") return { preset };
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    // `custom` without usable bounds would leave the Custom chip highlighted
    // while the server quietly served the default period — a control that
    // disagrees with the data it labels. Fall back the same way the server does.
    if (!isValidYmd(from) || !isValidYmd(to)) return { preset: DEFAULT_PRESET };
    return { preset, from, to };
  });

  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/broker/customer?broker=${encodeURIComponent(broker)}&customer=${encodeURIComponent(customer)}&${toQuery(range)}`,
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
  }, [broker, customer, range]);

  useEffect(() => { load(); }, [load]);

  const dormant = data?.status === "dormant";

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 py-5 border-b border-white/[0.08]">
        <Link
          href={`/broker/${encodeURIComponent(broker)}`}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          {broker}
        </Link>
      </header>

      <div className="flex-1 px-4 sm:px-8 py-6 space-y-6 overflow-auto">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-white break-words">{customer}</h1>
            {data && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                    dormant
                      ? "border-amber-500/30 bg-amber-500/[0.08] text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400"
                  }`}
                >
                  {dormant ? <MoonStar className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                  {dormant ? "Not running" : "Currently running"}
                </span>
                <span className="text-slate-500 text-sm">
                  Last load {fmtGap(data.daysSinceLastLoad)} ({fmtDate(data.lastLoadDate)}) · first{" "}
                  {fmtDate(data.firstLoadDate)}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Carries the selected window through, so the report covers the
                period the broker is already looking at. */}
            <Link
              href={`/broker/${encodeURIComponent(broker)}/customer/${encodeURIComponent(customer)}/report?${toQuery(range)}`}
              className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white border border-white/10 hover:border-white/25 px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              <FileText className="w-4 h-4" />
              Client report
            </Link>
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>

        {error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <p className="text-red-400 text-base">
              {error === "No loads for this customer"
                ? `${broker} has no loads with this customer.`
                : error}
            </p>
            <Link
              href={`/broker/${encodeURIComponent(broker)}`}
              className="text-sm text-slate-400 hover:text-white border border-white/10 hover:border-white/20 px-4 py-2 rounded-lg transition-colors"
            >
              Back to {broker}
            </Link>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-slate-500">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-600 border-t-slate-400 rounded-full" />
              Loading…
            </div>
          </div>
        ) : (
          <>
            {/* Money owed outranks activity: if this account is badly past due,
                that's the thing to know before booking another load. Stated as a
                fact with no action attached — the collectors run the chase on
                their own cadence, which a broker can't see from here. */}
            {data.ar?.seriouslyPastDue && (
              <div className="rounded-xl border-2 border-rose-500/40 bg-rose-500/[0.07] px-5 py-4">
                <p className="text-rose-300 font-semibold text-lg">
                  {fmtMoney(data.ar.overdueTotal)} past due — oldest {data.ar.oldestDaysOverdue} days.
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  {fmtMoney(data.ar.totalOpen)} open across {data.ar.invoiceCount}{" "}
                  {data.ar.invoiceCount === 1 ? "invoice" : "invoices"}
                  {data.ar.parkedTotal > 0
                    ? `, of which ${fmtMoney(data.ar.parkedTotal)} is on hold, disputed or under a promise to pay`
                    : ""}
                  . Collections is chasing this — check with Jacob before booking more.
                </p>
              </div>
            )}

            {dormant && (
              <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
                <p className="text-amber-300 font-semibold">
                  Nothing run in {data.daysSinceLastLoad} days.
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  {data.lifetime.loads} loads and {fmtMoney(data.lifetime.margin)} of margin all-time,
                  averaging {fmtMoney(data.lifetime.avgPerLoad)} a load. Last one moved{" "}
                  {fmtDate(data.lastLoadDate)}.
                </p>
              </div>
            )}

            {/* Period vs lifetime */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
                <p className="text-xs text-emerald-400/80 uppercase tracking-wider mb-1">Margin</p>
                <p className="text-xl font-bold text-emerald-400 tabular-nums">
                  {fmtMoney(data.period.margin)}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">{data.range.label}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Loads</p>
                <p className="text-xl font-bold text-white tabular-nums">{data.period.loads}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {fmtMoney(data.period.revenue)} revenue
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Avg / Load</p>
                <p className="text-xl font-bold text-white tabular-nums">
                  {data.period.loads > 0 ? fmtMoney(data.period.avgPerLoad) : "—"}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {data.period.loads > 0 ? `${data.period.marginPct.toFixed(1)}% margin` : "no loads"}
                </p>
              </div>
              {/* Explicitly "margin", with revenue underneath. Unlabelled, this
                  read as all-time REVENUE and looked like it contradicted the
                  customer's open AR — which is revenue, and can dwarf margin. */}
              {/* What they OWE, beside what they earned. This card is the whole
                  reason margin got labelled: the two are different measures and
                  open AR is routinely many times lifetime margin. */}
              <div
                className={`rounded-xl border px-4 py-3 ${
                  data.ar?.seriouslyPastDue
                    ? "border-rose-500/30 bg-rose-500/[0.05]"
                    : "border-white/[0.06] bg-white/[0.02]"
                }`}
              >
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Open AR</p>
                {data.ar ? (
                  <>
                    <p className="text-xl font-bold text-white tabular-nums">
                      {fmtMoney(data.ar.totalOpen)}
                    </p>
                    <p
                      className={`text-xs mt-0.5 ${
                        data.ar.overdueTotal > 0 ? "text-rose-400/90" : "text-slate-600"
                      }`}
                    >
                      {data.ar.overdueTotal > 0
                        ? `${fmtMoney(data.ar.overdueTotal)} past due`
                        : "nothing past due"}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xl font-bold text-slate-600">$0</p>
                    <p className="text-xs text-slate-600 mt-0.5">all paid up</p>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">
                  All-Time Margin
                </p>
                <p className="text-xl font-bold text-white tabular-nums">
                  {fmtMoney(data.lifetime.margin)}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {data.lifetime.loads} loads · {fmtMoney(data.lifetime.revenue)} revenue
                </p>
              </div>
            </div>

            {/* Monthly trend */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-300">Margin by month</h2>
                <span className="text-xs text-slate-600">
                  Last {data.monthlyTrend.length} months — gaps are months with no loads
                </span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.monthlyTrend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fill: "#475569", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#475569", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={fmtK}
                    width={44}
                  />
                  <Tooltip content={<TrendTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar dataKey="margin" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                    {data.monthlyTrend.map((m, i) => (
                      <Cell key={i} fill={m.loads === 0 ? "#1e293b" : "#10b981"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Lanes + carriers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[
                { title: "Top Lanes", rows: data.topLanes.map((l) => ({ label: l.lane, ...l })) },
                { title: "Top Carriers", rows: data.topCarriers.map((c) => ({ label: c.carrier, ...c })) },
              ].map((panel) => (
                <div key={panel.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <h2 className="text-sm font-semibold text-slate-300 mb-1">{panel.title}</h2>
                  <p className="text-xs text-slate-600 mb-3">{data.range.label}</p>
                  {panel.rows.length === 0 ? (
                    <p className="text-slate-600 text-sm">No loads in this period</p>
                  ) : (
                    <div className="space-y-2">
                      {panel.rows.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0"
                        >
                          <span className="text-sm text-slate-300 truncate">{r.label}</span>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-semibold text-emerald-400">
                              {fmtMoney(r.margin)}
                            </span>
                            <span className="text-xs text-slate-600 ml-2">{r.loads} loads</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Load list */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-300">Loads</h2>
                <span className="text-xs text-slate-600">{data.range.label}</span>
              </div>
              {data.loads.length === 0 ? (
                <p className="text-slate-600 text-sm py-2">
                  No loads with {data.customer} in this period.
                </p>
              ) : (
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="text-xs text-slate-600 uppercase tracking-wider border-b border-white/[0.06]">
                        <th className="text-left font-medium py-2">Load</th>
                        <th className="text-left font-medium py-2">Pickup</th>
                        <th className="text-left font-medium py-2">Lane</th>
                        <th className="text-left font-medium py-2">Carrier</th>
                        <th className="text-right font-medium py-2">Revenue</th>
                        <th className="text-right font-medium py-2">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.loads.map((l) => (
                        <tr key={l.loadNumber} className="border-b border-white/[0.03] last:border-0">
                          <td className="py-2 text-slate-500 font-mono text-xs">{l.loadNumber}</td>
                          <td className="py-2 text-slate-400 whitespace-nowrap">
                            {fmtDate(l.pickupDate, false)}
                          </td>
                          <td className="py-2 text-slate-300">
                            {l.origin} → {l.destination}
                          </td>
                          <td className="py-2 text-slate-400 truncate max-w-[180px]">{l.carrier}</td>
                          <td className="py-2 text-right text-slate-400 tabular-nums">
                            {fmtMoney(l.revenue)}
                          </td>
                          <td
                            className={`py-2 text-right font-semibold tabular-nums ${
                              l.margin < 0 ? "text-red-400" : "text-emerald-400"
                            }`}
                          >
                            {fmtMoney(l.margin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
