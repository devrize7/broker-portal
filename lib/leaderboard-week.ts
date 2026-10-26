/**
 * Leaderboard week bounds — America/New_York calendar dates, Mon 12:00 AM
 * through Sun 11:59:59 PM, attributed by the load's pickup date.
 *
 * This is the same calendar the broker drill-down and the sales contest
 * already use (`etYmd` + `startOfWeek` + half-open `YYYY-MM-DD` compare).
 * It used to be reimplemented in the leaderboard route with `new Date(y, m, d)`,
 * which is midnight in the server's zone. On Vercel that zone is UTC, so the
 * week opened Sunday 8:00 PM EDT (7:00 PM EST) and Sunday-evening pickups
 * landed in the next week. DST made a single UTC offset wrong too: the week
 * of Oct 26, 2026 starts in EDT and ends, after the Nov 1 fall-back, in EST.
 *
 * Nothing here reads the server timezone. Instants become ET calendar dates
 * through `Intl`, and day arithmetic goes through `Date.UTC`.
 */

import { addDays, startOfWeek, todayET } from "@/lib/date-ranges";
import { etYmd } from "@/lib/load-query";

/** Pickup instant → America/New_York calendar date (`YYYY-MM-DD`). */
export function pickupYmd(pickupIso: string): string {
  return etYmd(pickupIso);
}

/** Monday (`YYYY-MM-DD`) of the ET week that contains this pickup. */
export function weekKeyOfPickup(pickupIso: string): string {
  return startOfWeek(etYmd(pickupIso));
}

/**
 * Half-open ET calendar window. `from <= pickup date < toExclusive`, so a
 * Sunday pickup — including one whose UTC instant is already Monday — stays
 * in the week that contains that Sunday, and Monday 12:00 AM ET opens the next.
 */
export function pickupInRange(pickupIso: string, from: string, toExclusive: string): boolean {
  const ymd = etYmd(pickupIso);
  return ymd >= from && ymd < toExclusive;
}

/**
 * Monday of the ET week containing `now`, shifted by whole weeks.
 * `weekOffset` 0 is the current week, -1 the previous one.
 */
export function mondayKeyForInstant(now: Date, weekOffset = 0): string {
  return addDays(startOfWeek(todayET(now)), weekOffset * 7);
}

/**
 * UTC midnight of a `YYYY-MM-DD` calendar date.
 *
 * `getWeeklyGoal` / `getRampStatus` subtract a hire date parsed as UTC
 * midnight (`new Date("YYYY-MM-DD")`). The week Monday has to be that same
 * instant — which is what `new Date(y, m, d)` happened to be on Vercel — or
 * the ramp-week count moves. This is not the ET week boundary; the week
 * boundary is the calendar-date compare above.
 */
export function utcMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Fraction of the Mon–Fri work week elapsed, in America/New_York.
 * Business hours are 8:00–18:00. Saturday is already past those five days.
 * Sunday is the last day of the week, so it is full pace too — a 0 here
 * zeroed `pacedGoal` and marked every broker "ahead" for all of Sunday.
 */
export function weekPaceFactor(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekdayStr = parts.find((p) => p.type === "weekday")!.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayStr);
  const hour =
    parseInt(parts.find((p) => p.type === "hour")!.value, 10) +
    parseInt(parts.find((p) => p.type === "minute")!.value, 10) / 60;
  if (day === 0 || day === 6) return 1;
  const dayIndex = day - 1;
  const dayProgress = Math.min(Math.max((hour - 8) / 10, 0), 1);
  return Math.min((dayIndex + dayProgress) / 5, 1);
}
