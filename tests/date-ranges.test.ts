import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET,
  addDays,
  addMonths,
  daysBetween,
  isValidYmd,
  parsePreset,
  resolveRange,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  todayET,
} from "@/lib/date-ranges";

describe("calendar helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds days across a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("adds months from the first of a month", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-01-01", 3)).toBe("2026-04-01");
  });

  it("finds the start of the month and quarter", () => {
    expect(startOfMonth("2026-07-29")).toBe("2026-07-01");
    expect(startOfQuarter("2026-07-29")).toBe("2026-07-01");
    expect(startOfQuarter("2026-06-30")).toBe("2026-04-01");
    expect(startOfQuarter("2026-01-05")).toBe("2026-01-01");
    expect(startOfQuarter("2026-12-31")).toBe("2026-10-01");
  });

  it("finds Monday for every day of the week, including Sunday", () => {
    // 2026-07-27 is a Monday; 2026-08-02 the Sunday that closes that week.
    for (const [day, monday] of [
      ["2026-07-27", "2026-07-27"],
      ["2026-07-29", "2026-07-27"],
      ["2026-08-01", "2026-07-27"],
      ["2026-08-02", "2026-07-27"], // Sunday belongs to the week that opened Mon
      ["2026-08-03", "2026-08-03"],
    ]) {
      expect(startOfWeek(day)).toBe(monday);
    }
  });

  it("counts days between dates, signed", () => {
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(30);
    expect(daysBetween("2026-07-31", "2026-07-01")).toBe(-30);
  });

  it("validates calendar dates, rejecting well-shaped impossible ones", () => {
    expect(isValidYmd("2026-07-29")).toBe(true);
    expect(isValidYmd("2026-02-31")).toBe(false);
    expect(isValidYmd("2026-7-9")).toBe(false);
    expect(isValidYmd("")).toBe(false);
    expect(isValidYmd(null)).toBe(false);
    expect(isValidYmd(20260729)).toBe(false);
  });
});

describe("todayET", () => {
  it("uses the Eastern calendar date, not the UTC one", () => {
    // 03:30 UTC on the 30th is still 23:30 on the 29th in New York. A naive
    // toISOString() here would report the wrong day — this is the exact class
    // of bug that made every broker goal read a week stale on Vercel.
    expect(todayET(new Date("2026-07-30T03:30:00Z"))).toBe("2026-07-29");
    expect(todayET(new Date("2026-07-30T16:00:00Z"))).toBe("2026-07-30");
  });
});

describe("resolveRange", () => {
  const today = "2026-07-29"; // a Wednesday

  it("resolves the week presets Mon–Sun", () => {
    const r = resolveRange("this_week", { today });
    expect([r.from, r.toExclusive, r.toDisplay]).toEqual([
      "2026-07-27",
      "2026-08-03",
      "2026-08-02",
    ]);

    const last = resolveRange("last_week", { today });
    expect([last.from, last.toExclusive]).toEqual(["2026-07-20", "2026-07-27"]);
    expect(last.label).toBe("Week of Jul 20");
  });

  it("resolves month presets to whole calendar months", () => {
    const r = resolveRange("this_month", { today });
    expect([r.from, r.toExclusive, r.toDisplay]).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-07-31",
    ]);

    const last = resolveRange("last_month", { today });
    expect([last.from, last.toExclusive]).toEqual(["2026-06-01", "2026-07-01"]);
    expect(last.label).toBe("June 2026");
  });

  it("resolves quarter presets", () => {
    const r = resolveRange("this_quarter", { today });
    expect([r.from, r.toExclusive]).toEqual(["2026-07-01", "2026-10-01"]);

    const last = resolveRange("last_quarter", { today });
    expect([last.from, last.toExclusive]).toEqual(["2026-04-01", "2026-07-01"]);
    expect(last.label).toBe("Q2 2026");
  });

  it("rolls last_quarter back across a year boundary", () => {
    const last = resolveRange("last_quarter", { today: "2026-02-10" });
    expect([last.from, last.toExclusive]).toEqual(["2025-10-01", "2026-01-01"]);
    expect(last.label).toBe("Q4 2025");
  });

  it("resolves ytd and all", () => {
    expect(resolveRange("ytd", { today }).from).toBe("2026-01-01");
    expect(resolveRange("ytd", { today }).toExclusive).toBe("2027-01-01");

    const all = resolveRange("all", { today });
    // Open at both ends — future-dated pickups are real and must not drop out.
    expect(all.from < "1900-01-01").toBe(true);
    expect(all.toExclusive > "2100-01-01").toBe(true);
  });

  it("ends partial periods at the period end, not at today", () => {
    // A load already scheduled for later this month counts toward This Month.
    const r = resolveRange("this_month", { today });
    expect("2026-07-31" >= r.from && "2026-07-31" < r.toExclusive).toBe(true);
  });

  it("builds a custom range with an exclusive upper bound", () => {
    const r = resolveRange("custom", { today, from: "2026-05-04", to: "2026-05-10" });
    expect([r.from, r.toExclusive, r.toDisplay]).toEqual([
      "2026-05-04",
      "2026-05-11",
      "2026-05-10",
    ]);
    expect(r.label).toBe("May 4 – May 10");
  });

  it("swaps reversed custom bounds instead of returning an empty range", () => {
    const r = resolveRange("custom", { today, from: "2026-05-10", to: "2026-05-04" });
    expect([r.from, r.toExclusive]).toEqual(["2026-05-04", "2026-05-11"]);
  });

  it("falls back to the default preset on unusable custom bounds", () => {
    for (const bad of [
      { from: "2026-05-04", to: null },
      { from: "nonsense", to: "2026-05-10" },
      { from: "2026-02-31", to: "2026-05-10" },
    ]) {
      const r = resolveRange("custom", { today, ...bad });
      expect(r.preset).toBe(DEFAULT_PRESET);
      expect(r.from).toBe("2026-07-01");
    }
  });

  it("keeps every range half-open and non-empty", () => {
    for (const preset of [
      "this_week",
      "last_week",
      "this_month",
      "last_month",
      "this_quarter",
      "last_quarter",
      "ytd",
      "all",
    ] as const) {
      const r = resolveRange(preset, { today });
      expect(r.from < r.toExclusive).toBe(true);
      expect(r.toDisplay < r.toExclusive).toBe(true);
    }
  });
});

describe("parsePreset", () => {
  it("accepts known presets and defaults everything else", () => {
    expect(parsePreset("last_month")).toBe("last_month");
    expect(parsePreset("all")).toBe("all");
    expect(parsePreset("garbage")).toBe(DEFAULT_PRESET);
    expect(parsePreset(undefined)).toBe(DEFAULT_PRESET);
    expect(parsePreset(null)).toBe(DEFAULT_PRESET);
  });
});
