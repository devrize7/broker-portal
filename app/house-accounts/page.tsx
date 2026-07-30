"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import RangePicker, { toQuery, type RangeSelection } from "@/components/range-picker";
import CustomerBookPanel, { type CustomerEntry } from "@/components/customer-book-panel";
import { DEFAULT_PRESET } from "@/lib/date-ranges";
import { fmtMoney } from "@/lib/format";

interface HouseAccounts {
  range: { preset: string; label: string; from: string; to: string };
  active: CustomerEntry[];
  dormant: CustomerEntry[];
  dormantDays: number;
  periodTotals: { loads: number; revenue: number; margin: number };
  lifetimeMargin: number;
}

/**
 * Admin-only: customers whose rep has departed, so no broker sees them on their
 * own page. The client gate below is convenience — `/api/house-accounts`
 * enforces admin server-side and is the actual authority.
 */
export default function HouseAccountsPage() {
  const { data: session, status } = useSession();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin ?? false;

  const [range, setRange] = useState<RangeSelection>({ preset: DEFAULT_PRESET });
  const [data, setData] = useState<HouseAccounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/house-accounts?${toQuery(range)}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }
  }, [range]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col items-center justify-center gap-3">
        <p className="text-slate-400">This page is admin-only.</p>
        <Link href="/leaderboard" className="text-sm text-emerald-400 hover:text-emerald-300">
          Back to the leaderboard
        </Link>
      </div>
    );
  }

  const totalAccounts = (data?.active.length ?? 0) + (data?.dormant.length ?? 0);

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 py-5 border-b border-white/[0.08]">
        <Link
          href="/leaderboard"
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Leaderboard
        </Link>
      </header>

      <div className="flex-1 px-4 sm:px-8 py-6 space-y-6 overflow-auto">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-slate-500" />
              House accounts
            </h1>
            <p className="text-slate-500 text-sm mt-1 max-w-2xl">
              Customers whose rep has departed or was never recorded. They don&apos;t appear on any
              broker&apos;s page, so nobody is working them.
            </p>
          </div>
          <RangePicker value={range} onChange={setRange} />
        </div>

        {error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <p className="text-red-400">{error}</p>
            <button
              onClick={load}
              className="text-sm text-slate-400 hover:text-white border border-white/10 hover:border-white/20 px-4 py-2 rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center h-64 text-slate-500">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Accounts</p>
                <p className="text-xl font-bold text-white tabular-nums">{totalAccounts}</p>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
                <p className="text-xs text-amber-400/90 uppercase tracking-wider mb-1">Not running</p>
                <p className="text-xl font-bold text-amber-300 tabular-nums">{data.dormant.length}</p>
                <p className="text-xs text-slate-600 mt-0.5">unattended</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Margin</p>
                <p className="text-xl font-bold text-white tabular-nums">
                  {fmtMoney(data.periodTotals.margin)}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">{data.range.label}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">All-Time Margin</p>
                <p className="text-xl font-bold text-white tabular-nums">
                  {fmtMoney(data.lifetimeMargin)}
                </p>
              </div>
            </div>

            <CustomerBookPanel
              active={data.active}
              dormant={data.dormant}
              dormantDays={data.dormantDays}
              rangeLabel={data.range.label}
              hrefFor={null}
            />

            <p className="text-xs text-slate-700 max-w-3xl">
              Attribution comes from each load&apos;s sales rep, which TAI stamps at creation and
              never clears — &ldquo;was &lt;name&gt;&rdquo; means the last rep TAI recorded, not a
              current owner. There is no customer-ownership record in the system to read instead.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
