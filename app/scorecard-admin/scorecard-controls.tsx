"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Mail, RefreshCw, ShieldCheck } from "lucide-react";

interface ControlState {
  automation: {
    displayName: string;
    description: string;
    enabled: boolean;
    schedule: string;
    lastSentAt: string | null;
    lastTriggeredBy: string | null;
    lastResult: unknown;
  };
  delivery: { cc: string[]; recipientRule: string };
  preview: { synthetic: true; broker: string; weekRangeLabel: string; html: string };
}

export function ScorecardControls() {
  const [data, setData] = useState<ControlState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/broker-scorecard", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the scorecard controls.");
      setData((await response.json()) as ControlState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the scorecard controls.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setEnabled(enabled: boolean) {
    if (enabled && !window.confirm("Enable weekly scorecards for all active brokers every Monday at 12:00 PM Eastern?")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/broker-scorecard", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("The delivery setting could not be saved.");
      setData((current) => current ? {
        ...current,
        automation: { ...current.automation, enabled },
      } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The delivery setting could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-slate-300">Loading scorecard controls…</div>;
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
        <p className="font-semibold text-red-200">Controls unavailable</p>
        <p className="mt-2 text-sm text-red-100/70">{error}</p>
        <button onClick={() => void load()} className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {data.automation.enabled ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <ShieldCheck className="h-5 w-5 text-amber-400" />}
              <p className="text-lg font-semibold">{data.automation.enabled ? "Delivery enabled" : "Delivery paused"}</p>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{data.automation.description}</p>
          </div>
          <button
            disabled={saving}
            onClick={() => void setEnabled(!data.automation.enabled)}
            className={`min-w-40 rounded-xl px-5 py-3 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
              data.automation.enabled
                ? "border border-red-400/30 bg-red-400/10 text-red-200 hover:bg-red-400/15"
                : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            }`}
          >
            {saving ? "Saving…" : data.automation.enabled ? "Pause delivery" : "Enable delivery"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <InfoCard icon={<CalendarClock className="h-5 w-5 text-blue-400" />} label="Schedule" value="Monday · 12:00 PM Eastern" />
          <InfoCard icon={<Mail className="h-5 w-5 text-violet-400" />} label="Copied on every email" value={data.delivery.cc.join(", ")} />
          <InfoCard
            icon={<RefreshCw className="h-5 w-5 text-emerald-400" />}
            label="Last run"
            value={lastRunSummary(data.automation.lastSentAt, data.automation.lastResult)}
          />
        </div>
        <p className="mt-4 text-xs text-slate-500">{data.delivery.recipientRule} Enabling this does not send immediately; it starts with the next eligible Monday window.</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <div className="flex flex-col gap-2 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Email preview</h2>
            <p className="mt-1 text-sm text-slate-400">Synthetic sample only · no email is sent from this preview.</p>
          </div>
          <span className="w-fit rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">Sample data</span>
        </div>
        <iframe
          title={`Weekly scorecard preview for ${data.preview.broker}`}
          srcDoc={data.preview.html}
          sandbox=""
          className="h-[720px] w-full bg-white"
        />
      </section>
    </div>
  );
}

function lastRunSummary(lastRunAt: string | null, result: unknown): string {
  if (!lastRunAt) return "Not run yet";
  const timestamp = new Date(lastRunAt).toLocaleString();
  if (typeof result !== "object" || result === null || Array.isArray(result)) return timestamp;
  const record = result as Record<string, unknown>;
  const sent = typeof record.sent === "number" ? record.sent : null;
  const failed = Array.isArray(record.failed) ? record.failed.length : null;
  if (sent === null && failed === null) return timestamp;
  return `${timestamp} · ${sent ?? 0} sent, ${failed ?? 0} failed`;
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">{icon}{label}</div>
      <p className="mt-3 break-words text-sm font-medium text-slate-200">{value}</p>
    </div>
  );
}
