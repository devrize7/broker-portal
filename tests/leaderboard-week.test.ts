import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Leaderboard weeks are America/New_York calendar dates: Monday 12:00 AM
 * through Sunday 11:59:59 PM, by pickup date. These cases run with the
 * process in UTC (vitest.config.ts sets TZ before workers spawn) because
 * that is Vercel's zone — the one where `new Date(y, m, d)` is midnight UTC
 * and the old week bounds flipped on Sunday evening.
 */
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

vi.mock("@/lib/route-auth", () => ({
  requireSession: async () => ({ session: { user: { email: "test@example.com" } }, response: null }),
}));

vi.mock("@/lib/roster", async () => {
  const actual = await vi.importActual<typeof import("@/lib/roster")>("@/lib/roster");
  return {
    ...actual,
    getRoster: async () => actual.buildRoster(actual.SEED_BROKERS),
  };
});

import { GET } from "@/app/api/leaderboard/route";
import {
  mondayKeyForInstant,
  pickupInRange,
  pickupYmd,
  utcMidnight,
  weekKeyOfPickup,
  weekPaceFactor,
} from "@/lib/leaderboard-week";

/** Oct 26, 2026 is a Monday. The week closes Sunday Nov 1, the fall-back day. */
const WEEK_OF_OCT_26 = "2026-10-26";
const NEXT_WEEK = "2026-11-02";

beforeEach(() => {
  executeMock.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UTC clock", () => {
  it("constructs local midnights as UTC midnights, matching Vercel", () => {
    // Guard for the whole file. If this fails, the Sunday-evening cases below
    // are not reproducing the production bug.
    expect(new Date(2026, 9, 26).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    // That instant is still Sunday evening in New York — the old week open.
    expect(pickupYmd("2026-10-26T00:00:00.000Z")).toBe("2026-10-25");
  });
});

describe("ET pickup week", () => {
  it("keeps a Sunday 11 PM ET pickup in the week that is closing", () => {
    // Sunday Oct 25, 11:00 PM EDT = Monday 03:00 UTC. The old instant compare
    // against Monday 00:00 UTC put this load in the week of Oct 26.
    expect(pickupYmd("2026-10-26T03:00:00.000Z")).toBe("2026-10-25");
    expect(weekKeyOfPickup("2026-10-26T03:00:00.000Z")).toBe("2026-10-19");
    expect(pickupInRange("2026-10-26T03:00:00.000Z", WEEK_OF_OCT_26, NEXT_WEEK)).toBe(false);

    // Sunday Nov 1, 11:00 PM EST (after the fall-back) = Monday Nov 2, 04:00 UTC.
    expect(pickupYmd("2026-11-02T04:00:00.000Z")).toBe("2026-11-01");
    expect(weekKeyOfPickup("2026-11-02T04:00:00.000Z")).toBe(WEEK_OF_OCT_26);
    expect(pickupInRange("2026-11-02T04:00:00.000Z", WEEK_OF_OCT_26, NEXT_WEEK)).toBe(true);
    expect(pickupInRange("2026-11-02T04:59:59.000Z", WEEK_OF_OCT_26, NEXT_WEEK)).toBe(true);
  });

  it("opens the week at Monday 12:30 AM ET, in both EDT and EST", () => {
    // Monday Oct 26, 12:30 AM EDT. A UTC-5 bound (05:00Z) would drop this.
    expect(pickupYmd("2026-10-26T04:30:00.000Z")).toBe("2026-10-26");
    expect(weekKeyOfPickup("2026-10-26T04:30:00.000Z")).toBe(WEEK_OF_OCT_26);
    expect(pickupInRange("2026-10-26T04:30:00.000Z", WEEK_OF_OCT_26, NEXT_WEEK)).toBe(true);

    // Monday Nov 2, 12:30 AM EST is the next week, not the one that just closed.
    expect(pickupYmd("2026-11-02T05:30:00.000Z")).toBe("2026-11-02");
    expect(weekKeyOfPickup("2026-11-02T05:30:00.000Z")).toBe(NEXT_WEEK);
    expect(pickupInRange("2026-11-02T05:30:00.000Z", WEEK_OF_OCT_26, NEXT_WEEK)).toBe(false);
    expect(pickupInRange("2026-11-02T05:00:00.000Z", WEEK_OF_OCT_26, NEXT_WEEK)).toBe(false);
  });

  it("keeps both 1:30 AMs on the Nov 1 2026 fall-back in that week", () => {
    // Clocks repeat 1:30 AM. Both instants are still Sunday Nov 1 in New York.
    expect(pickupYmd("2026-11-01T05:30:00.000Z")).toBe("2026-11-01"); // EDT, before the fall-back
    expect(pickupYmd("2026-11-01T06:30:00.000Z")).toBe("2026-11-01"); // EST, after the fall-back
    for (const iso of ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]) {
      expect(weekKeyOfPickup(iso)).toBe(WEEK_OF_OCT_26);
      expect(pickupInRange(iso, WEEK_OF_OCT_26, NEXT_WEEK)).toBe(true);
    }
  });

  it("names the current week from the ET date, including Sunday night", () => {
    // Sunday Nov 1, 11:00 PM EST is already Monday on a UTC clock.
    expect(mondayKeyForInstant(new Date("2026-11-02T04:00:00.000Z"))).toBe(WEEK_OF_OCT_26);
    expect(mondayKeyForInstant(new Date("2026-10-26T04:30:00.000Z"))).toBe(WEEK_OF_OCT_26);
    expect(mondayKeyForInstant(new Date("2026-11-02T05:30:00.000Z"))).toBe(NEXT_WEEK);
    expect(mondayKeyForInstant(new Date("2026-10-28T15:00:00.000Z"), -1)).toBe("2026-10-19");
  });

  it("counts a month-start mid-week pickup in the month of the pickup, not the week's Monday", () => {
    // Oct 1–4, 2026 are Thu–Sun. Their week opened Monday Sep 28.
    expect(weekKeyOfPickup("2026-10-01T04:30:00.000Z")).toBe("2026-09-28"); // Thu Oct 1, 12:30 AM EDT
    expect(weekKeyOfPickup("2026-10-05T03:00:00.000Z")).toBe("2026-09-28"); // Sun Oct 4, 11:00 PM EDT

    const october = ["2026-10-01", "2026-11-01"] as const;
    expect(pickupInRange("2026-10-01T04:30:00.000Z", ...october)).toBe(true);
    expect(pickupInRange("2026-10-05T03:00:00.000Z", ...october)).toBe(true);
    expect(pickupInRange("2026-09-30T16:00:00.000Z", ...october)).toBe(false);

    // Nov 1 is Sunday of the Oct 26 week, and it is November.
    expect(weekKeyOfPickup("2026-11-02T04:00:00.000Z")).toBe(WEEK_OF_OCT_26);
    expect(pickupInRange("2026-11-02T04:00:00.000Z", ...october)).toBe(false);
    expect(pickupInRange("2026-11-02T04:00:00.000Z", "2026-11-01", "2026-12-01")).toBe(true);

    // Same edge at the quarter and the year: the week's Monday is the prior period.
    const q4 = ["2026-10-01", "2027-01-01"] as const;
    expect(pickupInRange("2026-10-01T04:30:00.000Z", ...q4)).toBe(true);
    expect(pickupInRange("2026-09-30T16:00:00.000Z", ...q4)).toBe(false);
    expect(weekKeyOfPickup("2027-01-01T05:30:00.000Z")).toBe("2026-12-28"); // Fri Jan 1, 12:30 AM EST
    expect(pickupInRange("2027-01-01T05:30:00.000Z", ...q4)).toBe(false);
    expect(pickupInRange("2027-01-01T05:30:00.000Z", "2026-01-01", "2027-01-01")).toBe(false);
    expect(pickupInRange("2027-01-01T05:30:00.000Z", "2027-01-01", "2028-01-01")).toBe(true);
  });
});

describe("week pace", () => {
  it("treats Sunday as a finished week, including Sunday 11 PM ET", () => {
    expect(weekPaceFactor(new Date("2026-11-01T17:00:00.000Z"))).toBe(1); // Sunday noon EST
    expect(weekPaceFactor(new Date("2026-11-02T04:00:00.000Z"))).toBe(1); // Sunday 11:00 PM EST
    expect(weekPaceFactor(new Date("2026-10-25T03:00:00.000Z"))).toBe(1); // Sunday 11:00 PM EDT
  });

  it("leaves Monday-through-Saturday pace alone", () => {
    expect(weekPaceFactor(new Date("2026-10-26T04:30:00.000Z"))).toBe(0); // Mon 12:30 AM EDT
    expect(weekPaceFactor(new Date("2026-10-26T12:00:00.000Z"))).toBe(0); // Mon 8:00 AM EDT
    expect(weekPaceFactor(new Date("2026-10-26T22:00:00.000Z"))).toBeCloseTo(0.2); // Mon 6:00 PM
    expect(weekPaceFactor(new Date("2026-10-28T16:00:00.000Z"))).toBeCloseTo(0.48); // Wed noon
    expect(weekPaceFactor(new Date("2026-10-30T22:00:00.000Z"))).toBe(1); // Fri 6:00 PM
    expect(weekPaceFactor(new Date("2026-10-31T16:00:00.000Z"))).toBe(1); // Saturday noon
  });
});

describe("goal anchor", () => {
  it("anchors ramp math at UTC midnight of the Monday key", () => {
    expect(utcMidnight("2026-10-26").toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
});

interface LoadInput {
  salesRep?: string;
  revenue?: number;
  carrierCost?: number;
  pickupDate: string;
  profWeek?: string | null;
  status?: string;
  carrier?: string | null;
}

/** Positional Load row, in the leaderboard SELECT order. Margin = revenue − cost. */
function loadRow(input: LoadInput): unknown[] {
  return [
    input.salesRep ?? "Tom Licata",
    input.revenue ?? 0,
    input.carrierCost ?? 0,
    input.pickupDate,
    input.profWeek ?? null,
    input.status ?? "delivered",
    0,
    0,
    input.carrier === undefined ? "Acme Trucking" : input.carrier,
  ];
}

function marginLoad(pickupDate: string, margin: number, over: Partial<LoadInput> = {}): unknown[] {
  return loadRow({ pickupDate, revenue: 1000 + margin, carrierCost: 1000, ...over });
}

interface BrokerRow {
  broker: string;
  weeklyGoal: number;
  paceStatus: string;
  pacedGoal: number;
  current: { loads: number; margin: number };
  rolling4wAvg: { margin: number };
  record: { amount: number; weekOf: string };
}

interface LeaderboardBody {
  periodStart: string;
  periodEnd: string;
  weekStart: string;
  paceFactor: number;
  brokers: BrokerRow[];
}

async function leaderboard(params: string): Promise<LeaderboardBody> {
  const response = await GET(new NextRequest(`https://portal.test/api/leaderboard?${params}`));
  expect(response.status).toBe(200);
  return response.json();
}

function tom(body: LeaderboardBody): BrokerRow {
  const row = body.brokers.find((b) => b.broker === "Tom Licata");
  expect(row).toBeTruthy();
  return row!;
}

describe("GET /api/leaderboard week of Oct 26, 2026", () => {
  const rows = [
    marginLoad("2026-10-26T03:00:00.000Z", 111), // Sun Oct 25, 11:00 PM EDT — previous week
    marginLoad("2026-10-26T04:30:00.000Z", 222), // Mon Oct 26, 12:30 AM EDT
    marginLoad("2026-11-01T05:30:00.000Z", 10), // Sun Nov 1, 1:30 AM EDT (before fall-back)
    marginLoad("2026-11-01T06:30:00.000Z", 20), // Sun Nov 1, 1:30 AM EST (after fall-back)
    marginLoad("2026-11-02T04:00:00.000Z", 444), // Sun Nov 1, 11:00 PM EST
    marginLoad("2026-11-02T05:30:00.000Z", 888), // Mon Nov 2, 12:30 AM EST — next week
    marginLoad("2026-10-28T16:00:00.000Z", 9999, { status: "booked" }),
    loadRow({ pickupDate: "2026-10-28T16:00:00.000Z", revenue: 0, carrierCost: 1500 }),
  ];

  beforeEach(() => {
    executeMock.mockResolvedValue({ rows });
  });

  it("counts Monday 12:30 AM through Sunday 11 PM ET, and not the surrounding evenings", async () => {
    vi.setSystemTime(new Date("2026-10-28T15:00:00.000Z"));
    const body = await leaderboard("period=weekly");

    expect(body.periodStart).toBe(WEEK_OF_OCT_26);
    expect(body.periodEnd).toBe("2026-11-01");
    expect(body.weekStart).toBe(WEEK_OF_OCT_26);

    const broker = tom(body);
    // 222 + 10 + 20 + 444. The Sunday-before (111) and Monday-after (888) stay out,
    // as do the booked load and the $0-revenue load.
    expect(broker.current.loads).toBe(4);
    expect(broker.current.margin).toBe(696);
    // UTC midnight of this Monday — shifting the goal date a week would be 5600 or 5800.
    expect(broker.weeklyGoal).toBe(5700);

    const call = executeMock.mock.calls.find((args) => {
      const query = args[0] as { sql?: string };
      return typeof query?.sql === "string" && query.sql.includes("pickupDate >=");
    });
    expect(call?.[0]).toMatchObject({
      args: ["2026-09-28T00:00:00.000Z", "2026-09-28"],
    });
  });

  it("puts Sunday night on the previous week when that week is the one on screen", async () => {
    vi.setSystemTime(new Date("2026-10-28T15:00:00.000Z"));
    const body = await leaderboard("period=weekly&week=-1");
    expect(body.periodStart).toBe("2026-10-19");
    expect(body.periodEnd).toBe("2026-10-25");
    expect(tom(body).current.margin).toBe(111);
    expect(tom(body).current.loads).toBe(1);
  });

  it("attributes a Sunday 11 PM ET pickup to the closing week for pace, average, and record", async () => {
    vi.setSystemTime(new Date("2026-11-02T04:00:00.000Z")); // Sun Nov 1, 11:00 PM EST
    executeMock.mockResolvedValue({
      rows: [marginLoad("2026-11-02T04:00:00.000Z", 444)],
    });
    const closing = await leaderboard("period=weekly");
    expect(closing.periodStart).toBe(WEEK_OF_OCT_26);
    expect(closing.paceFactor).toBe(1);
    const closingTom = tom(closing);
    expect(closingTom.current.margin).toBe(444);
    // Full pace against a $5,700 goal. Pace 0 would have reported "ahead".
    expect(closingTom.paceStatus).toBe("behind");
    expect(closingTom.pacedGoal).toBe(5700);

    vi.setSystemTime(new Date("2026-11-04T15:00:00.000Z")); // Wed Nov 4, the next week
    const next = await leaderboard("period=weekly");
    expect(next.periodStart).toBe(NEXT_WEEK);
    const nextTom = tom(next);
    expect(nextTom.current.margin).toBe(0);
    expect(nextTom.current.loads).toBe(0);
    expect(nextTom.rolling4wAvg.margin).toBe(111); // 444 / 4 completed weeks
    expect(nextTom.record).toEqual({ amount: 444, weekOf: WEEK_OF_OCT_26 });
  });

  it("keeps profWeek as the weekly source of truth", async () => {
    vi.setSystemTime(new Date("2026-10-28T15:00:00.000Z"));
    executeMock.mockResolvedValue({
      rows: [
        marginLoad("2026-09-15T16:00:00.000Z", 500, { profWeek: WEEK_OF_OCT_26 }),
        marginLoad("2026-10-28T16:00:00.000Z", 999),
      ],
    });
    const body = await leaderboard("period=weekly");
    expect(tom(body).current.margin).toBe(500);
    expect(tom(body).current.loads).toBe(1);
  });

  it("reports full pace on Sunday and not on Monday morning", async () => {
    executeMock.mockResolvedValue({ rows: [marginLoad("2026-10-28T16:00:00.000Z", 100)] });

    vi.setSystemTime(new Date("2026-11-01T23:00:00.000Z")); // Sunday Nov 1, 6:00 PM EST
    const sunday = await leaderboard("period=weekly");
    expect(sunday.paceFactor).toBe(1);
    expect(tom(sunday).paceStatus).toBe("behind");

    vi.setSystemTime(new Date("2026-10-26T04:30:00.000Z")); // Monday Oct 26, 12:30 AM EDT
    const monday = await leaderboard("period=weekly");
    expect(monday.periodStart).toBe(WEEK_OF_OCT_26);
    expect(monday.paceFactor).toBe(0);
    expect(tom(monday).current.margin).toBe(100);
    // Pace 0 makes pacedGoal 0, so any positive margin reads "ahead".
    expect(tom(monday).paceStatus).toBe("ahead");
  });
});

describe("GET /api/leaderboard month, quarter, and year", () => {
  const rows = [
    marginLoad("2026-09-30T16:00:00.000Z", 100), // Wed Sep 30
    marginLoad("2026-10-01T04:30:00.000Z", 200), // Thu Oct 1, 12:30 AM EDT — week of Sep 28
    marginLoad("2026-10-05T03:00:00.000Z", 400), // Sun Oct 4, 11:00 PM EDT — week of Sep 28
    marginLoad("2026-11-02T04:00:00.000Z", 800), // Sun Nov 1, 11:00 PM EST — week of Oct 26
    marginLoad("2026-10-02T16:00:00.000Z", 50, { profWeek: "2026-09-28" }), // pickup in October
    marginLoad("2026-09-30T17:00:00.000Z", 70, { profWeek: "2026-10-05" }), // tag in October, pickup in September
    marginLoad("2027-01-01T05:30:00.000Z", 1600), // Fri Jan 1, 12:30 AM EST — week of Dec 28
    marginLoad("2026-10-15T16:00:00.000Z", 9999, { status: "booked" }),
    marginLoad("2026-10-15T16:00:00.000Z", 5, { status: "booked", profWeek: "2026-10-12" }),
  ];

  beforeEach(() => {
    executeMock.mockResolvedValue({ rows });
    vi.setSystemTime(new Date("2026-10-15T16:00:00.000Z"));
  });

  it("counts Oct 1–4 in October and Q4, and leaves Sep 30 and Nov 1 out of October", async () => {
    const month = await leaderboard("period=monthly");
    expect(month.periodStart).toBe("2026-10-01");
    expect(month.periodEnd).toBe("2026-10-31");
    // Oct 1 (200) + Oct 4 (400) + Oct 2 tagged to September (50) + booked profWeek load (5).
    expect(tom(month).current.margin).toBe(655);
    expect(tom(month).current.loads).toBe(4);

    const quarter = await leaderboard("period=quarterly");
    expect(quarter.periodStart).toBe("2026-10-01");
    expect(quarter.periodEnd).toBe("2026-12-31");
    // October loads above, plus Nov 1 (800). Jan 1 and Sep 30 stay out.
    expect(tom(quarter).current.margin).toBe(1455);
    expect(tom(quarter).current.loads).toBe(5);
  });

  it("keeps Jan 1 in the new year when its week opened in December", async () => {
    const year = await leaderboard("period=yearly");
    expect(year.periodStart).toBe("2026-01-01");
    expect(year.periodEnd).toBe("2026-12-31");
    // Every 2026 pickup above, including Sep 30 (100 and 70) and Nov 1 (800). Not Jan 1.
    expect(tom(year).current.margin).toBe(1625);
    expect(tom(year).current.loads).toBe(7);

    vi.setSystemTime(new Date("2027-01-15T15:00:00.000Z"));
    const nextYear = await leaderboard("period=yearly");
    expect(nextYear.periodStart).toBe("2027-01-01");
    expect(tom(nextYear).current.margin).toBe(1600);
    expect(tom(nextYear).current.loads).toBe(1);
  });
});
