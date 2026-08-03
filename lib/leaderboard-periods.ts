import { addDays, addMonths, resolveRange, startOfQuarter, startOfWeek, todayET } from "@/lib/date-ranges";

export const LEADERBOARD_PERIODS = ["weekly", "monthly", "quarterly", "yearly", "all-time"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export interface LeaderboardPeriodRange {
  period: LeaderboardPeriod;
  from: string;
  toExclusive: string;
  toDisplay: string;
  label: string;
}

export function parseLeaderboardPeriod(value: unknown): LeaderboardPeriod {
  return LEADERBOARD_PERIODS.includes(value as LeaderboardPeriod)
    ? (value as LeaderboardPeriod)
    : "weekly";
}

export function resolveLeaderboardPeriod(
  period: LeaderboardPeriod,
  opts: { now?: Date; weekOffset?: number } = {}
): LeaderboardPeriodRange {
  const today = todayET(opts.now);

  if (period === "weekly") {
    const monday = addDays(startOfWeek(today), (opts.weekOffset ?? 0) * 7);
    const range = resolveRange("custom", { from: monday, to: addDays(monday, 6) });
    return { period, from: range.from, toExclusive: range.toExclusive, toDisplay: range.toDisplay, label: "Weekly" };
  }

  if (period === "monthly") {
    const range = resolveRange("this_month", { today });
    return { period, ...range, label: "Monthly" };
  }

  if (period === "quarterly") {
    const from = startOfQuarter(today);
    const range = resolveRange("custom", { from, to: addDays(addMonths(from, 3), -1) });
    return { period, ...range, label: "Quarterly" };
  }

  if (period === "yearly") {
    const from = `${today.slice(0, 4)}-01-01`;
    const range = resolveRange("custom", { from, to: addDays(`${Number(today.slice(0, 4)) + 1}-01-01`, -1) });
    return { period, ...range, label: "Yearly" };
  }

  const range = resolveRange("all");
  return { period, ...range, label: "All-Time" };
}
