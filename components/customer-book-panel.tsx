"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight, MoonStar, TrendingUp } from "lucide-react";
import { fmtDate, fmtGap, fmtMoney } from "@/lib/format";

export interface BookStats {
  loads: number;
  revenue: number;
  margin: number;
}

export interface CustomerAr {
  totalOpen: number;
  overdueTotal: number;
  oldestDaysOverdue: number;
  seriouslyPastDue: boolean;
}

export interface CustomerEntry {
  customer: string;
  status: "active" | "dormant";
  lastLoadDate: string;
  daysSinceLastLoad: number;
  lifetime: BookStats;
  period: BookStats;
  /** What the CUSTOMER owes (whole balance, not this broker's slice). */
  ar?: CustomerAr | null;
  /** House-accounts view only: the last rep TAI stamped on the account. */
  lastRep?: string;
}

function Row({
  entry,
  href,
}: {
  entry: CustomerEntry;
  href: string | null;
}) {
  const dormant = entry.status === "dormant";
  const ranInPeriod = entry.period.loads > 0;

  const body = (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.04] last:border-0 group">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 truncate group-hover:text-white transition-colors">
          {entry.customer}
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          {dormant ? (
            <>
              {/* On a lapsed account the gap IS the headline. */}
              <span className="text-amber-500/80">last load {fmtGap(entry.daysSinceLastLoad)}</span>
              {" · "}
              {entry.lifetime.loads} loads all-time · {fmtMoney(entry.lifetime.margin)} margin
              {entry.lastRep ? ` · was ${entry.lastRep}` : ""}
            </>
          ) : ranInPeriod ? (
            <>
              {entry.period.loads} {entry.period.loads === 1 ? "load" : "loads"} · last{" "}
              {fmtDate(entry.lastLoadDate, false)}
              {entry.lastRep ? ` · ${entry.lastRep}` : ""}
            </>
          ) : (
            <>
              {/* Active relationship, nothing in the window — the "you have an
                  account you didn't run" conversation. Phrased without the
                  period name: labels range from "This month" to "June 2026" to
                  "Q2 2026", and no single preposition reads correctly for all
                  of them. The card header names the period once instead. */}
              <span className="text-slate-500">no loads this period</span>
              {" · last "}
              {fmtDate(entry.lastLoadDate, false)}
              {entry.lastRep ? ` · ${entry.lastRep}` : ""}
            </>
          )}
        </p>

        {/* Past-due flag. Deliberately a statement, not a call to action — the
            collectors own the chase and a broker can't see their cadence. What
            this should change is whether they book the NEXT load. */}
        {entry.ar?.seriouslyPastDue && (
          <p className="text-xs text-rose-400/90 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {fmtMoney(entry.ar.overdueTotal)} past due · oldest {entry.ar.oldestDaysOverdue}d
          </p>
        )}
      </div>

      <div className="text-right shrink-0 flex items-center gap-2">
        <div>
          <p
            className={`text-sm font-semibold tabular-nums ${
              dormant || !ranInPeriod ? "text-slate-600" : "text-emerald-400"
            }`}
          >
            {ranInPeriod ? fmtMoney(entry.period.margin) : "—"}
          </p>
          {!dormant && ranInPeriod && (
            <p className="text-[11px] text-slate-600">{fmtMoney(entry.lifetime.margin)} all-time margin</p>
          )}
        </div>
        {href && (
          <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-400 transition-colors shrink-0" />
        )}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function CustomerBookPanel({
  active,
  dormant,
  dormantDays,
  rangeLabel,
  hrefFor,
}: {
  active: CustomerEntry[];
  dormant: CustomerEntry[];
  dormantDays: number;
  rangeLabel: string;
  /** Null for surfaces with no drill-down (house accounts). */
  hrefFor: ((customer: string) => string) | null;
}) {
  const ranCount = active.filter((c) => c.period.loads > 0).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Active */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            Currently running
          </h2>
          <span className="text-xs text-slate-600">{active.length}</span>
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Ran a load in the last {dormantDays} days
          {active.length > 0 && (
            <>
              {" · "}
              {/* Period first, then the count — reads correctly whether the
                  label is "This month", "June 2026" or "Q2 2026". */}
              <span className={ranCount === 0 ? "text-amber-500/80" : ""}>
                {rangeLabel} — {ranCount} of {active.length} ran
              </span>
            </>
          )}
        </p>
        {active.length === 0 ? (
          <p className="text-slate-600 text-sm py-2">No active customers.</p>
        ) : (
          <div>
            {active.map((c) => (
              <Row key={c.customer} entry={c} href={hrefFor?.(c.customer) ?? null} />
            ))}
          </div>
        )}
      </div>

      {/* Dormant */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <MoonStar className="w-3.5 h-3.5 text-amber-500" />
            Not running
          </h2>
          <span className="text-xs text-slate-600">{dormant.length}</span>
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Have run before, nothing in {dormantDays}+ days — most recent first
        </p>
        {dormant.length === 0 ? (
          <p className="text-slate-600 text-sm py-2">
            Nothing has gone quiet. Every customer has run in the last {dormantDays} days.
          </p>
        ) : (
          <div>
            {dormant.map((c) => (
              <Row key={c.customer} entry={c} href={hrefFor?.(c.customer) ?? null} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
