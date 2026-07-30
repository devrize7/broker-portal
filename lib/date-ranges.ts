/**
 * Date-range presets for the broker drill-down ("what did they do last week /
 * last month / last quarter").
 *
 * EVERYTHING here works on plain calendar-date STRINGS (`YYYY-MM-DD`), never on
 * Date instants. That is deliberate:
 *
 *  - Callers compare against a load's ET calendar date (`CountableLoad.pickupYmd`,
 *    derived once in lib/load-query.ts). A range filter is therefore a plain
 *    lexicographic string compare — `from <= pickupYmd < toExclusive` — with no
 *    timezone math at comparison time at all.
 *  - Calendar arithmetic (month/quarter/week boundaries) runs through `Date.UTC`
 *    on those Y/M/D triples, so DST can never shift a boundary. This repo has
 *    already been bitten by week math that was a no-op locally and off by a week
 *    on Vercel (UTC) — see the goal-derivation note in freight-dashboard
 *    CLAUDE.md. Only `todayET` touches a real instant, and it immediately
 *    collapses it to a calendar date in America/New_York.
 *
 * Ranges are half-open: `[from, toExclusive)`. The upper bound is exclusive so a
 * noon-UTC pickup on the last day of the period is never silently dropped
 * (`'2026-07-31T12:00…' > '2026-07-31'` lexicographically, which an inclusive
 * bound would have excluded).
 */

export type RangePreset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "ytd"
  | "all"
  | "custom";

export interface DateRange {
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  from: string;
  /** EXCLUSIVE upper bound, `YYYY-MM-DD`. */
  toExclusive: string;
  /** Inclusive last day of the range — for display only. */
  toDisplay: string;
  preset: RangePreset;
  label: string;
}

/**
 * The default period for the broker page. Mirrors the freight-dashboard
 * `/brokers` screen, which also defaults to This Month. The client and the
 * server MUST agree on this — when they drifted on the dashboard the filter
 * chip read "This Month" over all-time data. Both sides import this constant.
 */
export const DEFAULT_PRESET: RangePreset = "this_month";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in America/New_York — the only instant→date crossing. */
export function todayET(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // en-CA formats as YYYY-MM-DD.
  return parts;
}

function toUTC(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = toUTC(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

export function addMonths(ymd: string, months: number): string {
  const d = toUTC(ymd);
  // Always anchored to the 1st by every caller here, so there's no
  // end-of-month clamping hazard (Jan 31 + 1 month).
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUTC(d);
}

/** First day of `ymd`'s month. */
export function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** First day of `ymd`'s calendar quarter. */
export function startOfQuarter(ymd: string): string {
  const month = Number(ymd.slice(5, 7));
  const qStart = Math.floor((month - 1) / 3) * 3 + 1;
  return `${ymd.slice(0, 4)}-${String(qStart).padStart(2, "0")}-01`;
}

/** Monday of `ymd`'s week (weeks run Mon–Sun, matching every other Oath surface). */
export function startOfWeek(ymd: string): string {
  const dow = toUTC(ymd).getUTCDay(); // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDays(ymd, delta);
}

/** Whole days from `from` to `to`. Negative when `to` is in the future. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000);
}

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  // Reject impossible dates that still match the shape (2026-02-31).
  return fromUTC(toUTC(value)) === value;
}

function monthLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shortLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function quarterLabel(ymd: string): string {
  const q = Math.floor(Number(ymd.slice(5, 7)) / 3) + 1;
  return `Q${q} ${ymd.slice(0, 4)}`;
}

/**
 * Resolve a preset (plus optional custom bounds) into a concrete half-open range.
 *
 * Partial calendar periods (this week/month/quarter, YTD) run to the END of the
 * period, not to today — so a load already scheduled for later this month counts
 * toward "This Month". That matches how a broker reads their own book.
 */
export function resolveRange(
  preset: RangePreset,
  opts: { today?: string; from?: string | null; to?: string | null } = {}
): DateRange {
  const today = opts.today ?? todayET();

  const make = (from: string, toExclusive: string, label: string, p: RangePreset = preset): DateRange => ({
    from,
    toExclusive,
    toDisplay: addDays(toExclusive, -1),
    preset: p,
    label,
  });

  switch (preset) {
    case "this_week": {
      const monday = startOfWeek(today);
      return make(monday, addDays(monday, 7), "This week");
    }
    case "last_week": {
      const monday = addDays(startOfWeek(today), -7);
      return make(monday, addDays(monday, 7), `Week of ${shortLabel(monday)}`);
    }
    case "this_month": {
      const first = startOfMonth(today);
      return make(first, addMonths(first, 1), "This month");
    }
    case "last_month": {
      const first = addMonths(startOfMonth(today), -1);
      return make(first, addMonths(first, 1), monthLabel(first));
    }
    case "this_quarter": {
      const first = startOfQuarter(today);
      return make(first, addMonths(first, 3), "This quarter");
    }
    case "last_quarter": {
      const first = addMonths(startOfQuarter(today), -3);
      return make(first, addMonths(first, 3), quarterLabel(first));
    }
    case "ytd": {
      const first = `${today.slice(0, 4)}-01-01`;
      return make(first, `${Number(today.slice(0, 4)) + 1}-01-01`, "Year to date");
    }
    case "all":
      // Open at both ends: an "all time" pull must never silently drop the
      // future-dated pickups that legitimately exist in the book.
      return make("0001-01-01", "9999-12-31", "All time");
    case "custom": {
      if (!isValidYmd(opts.from) || !isValidYmd(opts.to)) {
        // Unparseable custom bounds fall back to the default preset rather than
        // inventing a range — the caller's label would otherwise lie.
        return resolveRange(DEFAULT_PRESET, { today });
      }
      const [from, to] = opts.from <= opts.to ? [opts.from, opts.to] : [opts.to, opts.from];
      return make(from, addDays(to, 1), `${shortLabel(from)} – ${shortLabel(to)}`);
    }
  }
}

export function parsePreset(value: unknown): RangePreset {
  const presets: RangePreset[] = [
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "this_quarter",
    "last_quarter",
    "ytd",
    "all",
    "custom",
  ];
  return presets.includes(value as RangePreset) ? (value as RangePreset) : DEFAULT_PRESET;
}
