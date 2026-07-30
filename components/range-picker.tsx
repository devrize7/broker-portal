"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { isValidYmd, type RangePreset } from "@/lib/date-ranges";

export interface RangeSelection {
  preset: RangePreset;
  from?: string;
  to?: string;
}

/** Ordered as they'd be asked for in a 1:1, shortest period first. */
const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
];

export function toQuery(sel: RangeSelection): string {
  const p = new URLSearchParams({ preset: sel.preset });
  if (sel.preset === "custom" && sel.from && sel.to) {
    p.set("from", sel.from);
    p.set("to", sel.to);
  }
  return p.toString();
}

export default function RangePicker({
  value,
  onChange,
}: {
  value: RangeSelection;
  onChange: (sel: RangeSelection) => void;
}) {
  const [showCustom, setShowCustom] = useState(value.preset === "custom");
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");

  const customReady = isValidYmd(from) && isValidYmd(to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              setShowCustom(false);
              onChange({ preset: p.value });
            }}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              value.preset === p.value
                ? "bg-white/10 border-white/20 text-white"
                : "border-white/[0.06] text-slate-500 hover:text-slate-300 hover:border-white/10"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom((s) => !s)}
          aria-expanded={showCustom}
          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
            value.preset === "custom"
              ? "bg-white/10 border-white/20 text-white"
              : "border-white/[0.06] text-slate-500 hover:text-slate-300 hover:border-white/10"
          }`}
        >
          <Calendar className="w-3 h-3" />
          Custom
        </button>
      </div>

      {showCustom && (
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Start date"
            className="bg-transparent text-xs text-slate-300 focus:outline-none [color-scheme:dark]"
          />
          <span className="text-slate-600 text-xs">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="End date"
            className="bg-transparent text-xs text-slate-300 focus:outline-none [color-scheme:dark]"
          />
          <button
            disabled={!customReady}
            onClick={() => onChange({ preset: "custom", from, to })}
            className="text-xs px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/[0.06] disabled:text-slate-600 text-white transition-colors"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
