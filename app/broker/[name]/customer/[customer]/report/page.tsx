"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DEFAULT_PRESET, isValidYmd, parsePreset } from "@/lib/date-ranges";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { CustomerReport, VolumeBucket, VolumePoint } from "@/lib/customer-report";

interface ReportResponse extends CustomerReport {
  customer: string;
  broker: string;
  rangeFrom: string;
  rangeTo: string;
  rangeLabel: string;
  brokerScoped: boolean;
}

/**
 * The report renders LIGHT, not in the portal's dark theme.
 *
 * This is the one page in the portal meant to leave the building — printed or
 * PDF'd and emailed to the customer. A dark document wastes a cartridge and
 * reads as a screenshot rather than a statement.
 */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, background: "#fff" }}>
      <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 6 }}>
        {label}
      </p>
      <p style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

/** Custom tooltip — matches the drill-down's pattern and avoids Recharts' formatter typing. */
const BUCKET_LABEL: Record<VolumeBucket, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};

/** How a bucket's start date reads on the axis and in the tooltip. */
function bucketPointLabel(start: string, bucket: VolumeBucket): string {
  if (bucket === "monthly") {
    return new Date(start + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return `${bucket === "biweekly" ? "Two weeks from" : "Week of"} ${fmtDate(start)}`;
}

function VolumeTooltip({
  active,
  payload,
  bucket,
}: {
  active?: boolean;
  payload?: Array<{ payload: VolumePoint }>;
  bucket: VolumeBucket;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
      <p style={{ color: "#64748b", marginBottom: 2 }}>{bucketPointLabel(d.start, bucket)}</p>
      <p style={{ fontWeight: 700, color: "#0f172a" }}>{d.loads} {d.loads === 1 ? "load" : "loads"}</p>
      <p style={{ color: "#64748b" }}>{fmtMoney(d.revenue)}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print-section" style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#0f172a", marginBottom: 12 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function CustomerReportPage() {
  const params = useParams<{ name: string; customer: string }>();
  const searchParams = useSearchParams();
  const broker = decodeURIComponent(params.name);
  const customer = decodeURIComponent(params.customer);

  const preset = parsePreset(searchParams.get("preset") ?? DEFAULT_PRESET);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ broker, customer, preset });
      if (preset === "custom" && isValidYmd(from) && isValidYmd(to)) {
        qs.set("from", from);
        qs.set("to", to);
      }
      const res = await fetch(`/api/broker/customer-report?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build report");
    }
  }, [broker, customer, preset, from, to]);

  useEffect(() => { load(); }, [load]);

  const backHref = `/broker/${encodeURIComponent(broker)}/customer/${encodeURIComponent(customer)}`;

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-slate-300 text-center max-w-md">{error}</p>
        <Link href={backHref} className="text-sm text-slate-400 hover:text-white transition-colors">
          ← Back to {customer}
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-slate-400 flex items-center justify-center">
        Building report…
      </div>
    );
  }

  const { stats, network, volume, topLanes } = data;
  const onTimeLabel = stats.onTime.onTimePct === null ? "—" : `${stats.onTime.onTimePct.toFixed(1)}%`;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          body { background: #fff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          .print-section { break-inside: avoid; page-break-inside: avoid; }
          .report-sheet { box-shadow: none !important; margin: 0 !important; max-width: none !important; }
        }
      `}</style>

      {/* Toolbar — never printed. */}
      <div
        className="no-print"
        style={{ background: "#0a0e17", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
      >
        <Link href={backHref} style={{ color: "#94a3b8", fontSize: 14, display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
          <ArrowLeft style={{ width: 16, height: 16 }} />
          {customer}
        </Link>
        <button
          onClick={() => window.print()}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "#f59e0b", color: "#0a0e17", fontWeight: 700, fontSize: 14, border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}
        >
          <Download style={{ width: 16, height: 16 }} />
          Export PDF
        </button>
      </div>

      <div
        className="report-sheet"
        style={{ maxWidth: 900, margin: "24px auto", background: "#fff", padding: 40, borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", color: "#0f172a", fontFamily: "system-ui, -apple-system, sans-serif" }}
      >
        {/* ── Header ── */}
        <div style={{ borderBottom: "2px solid #0f172a", paddingBottom: 20, marginBottom: 28 }}>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "#64748b", marginBottom: 6 }}>
            Oath Logistics · Service Report
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, marginBottom: 8 }}>{customer}</h1>
          <p style={{ fontSize: 14, color: "#475569" }}>
            {data.rangeLabel} · {fmtDate(data.rangeFrom)} – {fmtDate(data.rangeTo)}
            {data.firstLoadDate && <> · Partner since {fmtDate(data.firstLoadDate)}</>}
          </p>
          <p style={{ fontSize: 14, color: "#475569", marginTop: 4 }}>
            Prepared by {data.broker}
          </p>
        </div>

        {/* ── Headline stats ── */}
        <Section title="Summary">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Stat label="Total Spend" value={fmtMoney(stats.totalRevenue)} />
            <Stat label="Loads Moved" value={String(stats.totalLoads)} sub={`${stats.deliveredLoads} delivered`} />
            <Stat label="Avg per Load" value={fmtMoney(stats.avgRevPerLoad)} />
            <Stat
              label="On-Time Delivery"
              value={onTimeLabel}
              sub={
                stats.onTime.measured > 0
                  ? `${stats.onTime.onTimeCount} of ${stats.onTime.measured} graded`
                  : "no appointment data"
              }
            />
          </div>
        </Section>

        {/* ── Service quality ──
            On-time carries its coverage in plain language. A bare "100%" drawn
            from a handful of gradeable loads is a claim we cannot stand behind
            in front of the customer it is about. */}
        <Section title="Service Quality">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Stat label="Acceptance Rate" value={`${stats.acceptancePct.toFixed(1)}%`} sub={`${stats.cancelledCount} cancelled`} />
            <Stat
              label="Claims Filed"
              value={stats.claimsCount === null ? "—" : String(stats.claimsCount)}
              sub={stats.claimsPct === null ? "unavailable" : `${stats.claimsPct.toFixed(2)}% of loads`}
            />
            <Stat
              label="On-Time Coverage"
              value={stats.onTime.coveragePct === null ? "—" : `${stats.onTime.coveragePct.toFixed(0)}%`}
              sub={`${stats.onTime.measured} of ${stats.onTime.arrived} arrivals gradeable`}
            />
            <Stat
              label="Avg Transit"
              value={network.avgTransitDays === null ? "—" : `${network.avgTransitDays.toFixed(1)} days`}
            />
          </div>
          {stats.onTime.coveragePct !== null && stats.onTime.coveragePct < 100 && (
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 10, lineHeight: 1.5 }}>
              On-time is measured only against loads carrying a delivery appointment window
              in our system. Loads without one are excluded from the calculation rather than
              assumed on time.
            </p>
          )}
        </Section>

        {/* ── Network reach ── */}
        <Section title="Network">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Stat label="States Covered" value={String(network.statesCovered)} />
            <Stat label="Carrier Partners" value={String(network.carrierPartners)} />
            <Stat label="Total Miles" value={network.totalMiles.toLocaleString("en-US")} />
            <Stat label="Loads Delivered" value={String(stats.deliveredLoads)} />
          </div>
        </Section>

        {/* ── Volume trend ──
            Bars are LOAD COUNT: the question this answers for the customer is
            whether their freight with us is growing. The bucket adapts to the
            selected range (see pickVolumeBucket) so a year-to-date report is
            not 34 weekly bars, and a one-month report is not a single one. */}
        {volume.points.length > 1 && (
          <Section title={`${BUCKET_LABEL[volume.bucket]} Volume`}>
            <div style={{ height: 220, width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volume.points} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="start"
                    tickFormatter={(v: string) =>
                      volume.bucket === "monthly"
                        ? new Date(v + "T12:00:00").toLocaleDateString("en-US", { month: "short" })
                        : fmtDate(v, false)
                    }
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={{ stroke: "#cbd5e1" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip content={<VolumeTooltip bucket={volume.bucket} />} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
                  <Bar dataKey="loads" fill="#0f172a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
              Loads per {volume.bucket === "monthly" ? "month" : volume.bucket === "biweekly" ? "two weeks" : "week"}.
            </p>
          </Section>
        )}

        {/* ── Top lanes ── */}
        {topLanes.length > 0 && (
          <Section title="Top Lanes">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                  <th style={{ textAlign: "left", padding: "8px 4px", color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Lane</th>
                  <th style={{ textAlign: "right", padding: "8px 4px", color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Loads</th>
                  <th style={{ textAlign: "right", padding: "8px 4px", color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Spend</th>
                </tr>
              </thead>
              <tbody>
                {topLanes.map((l) => (
                  <tr key={l.lane} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 4px" }}>{l.lane}</td>
                    <td style={{ padding: "8px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.loads}</td>
                    <td style={{ padding: "8px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(l.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* ── Footer ──
            The scoping disclosure is not optional. These figures cover this
            broker's freight only; on an account shared with another rep the
            customer would otherwise reconcile a short total against their own
            records and conclude the report is wrong rather than partial. */}
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, marginTop: 8 }}>
          <p style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
            Figures cover freight moved with {data.broker} at Oath Logistics between{" "}
            {fmtDate(data.rangeFrom)} and {fmtDate(data.rangeTo)}, and may not reflect
            business placed through other Oath representatives. Spend excludes lumper and
            accessorial pass-throughs. Generated {fmtDate(new Date().toISOString().slice(0, 10))}.
          </p>
        </div>
      </div>
    </div>
  );
}
