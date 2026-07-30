import { describe, expect, it } from "vitest";
import { DORMANT_DAYS, buildCustomerBook, type BookLoadRow } from "@/lib/customer-book";
import { brokerSegmentOf } from "@/lib/broker-mapping";

const TODAY = "2026-07-29";
const RANGE = { rangeFrom: "2026-07-01", rangeToExclusive: "2026-08-01" };

const row = (over: Partial<BookLoadRow> = {}): BookLoadRow => ({
  customer: "Acme",
  pickupDate: "2026-07-15",
  revenue: 1000,
  carrierCost: 800,
  lumperRevenue: 0,
  lumperCost: 0,
  ...over,
});

const build = (rows: BookLoadRow[], over: Partial<Parameters<typeof buildCustomerBook>[1]> = {}) =>
  buildCustomerBook(rows, { today: TODAY, ...RANGE, ...over });

describe("active / dormant split", () => {
  it("splits on the dormancy line, inclusive of the boundary day", () => {
    const book = build([
      row({ customer: "Fresh", pickupDate: "2026-07-20" }),
      // exactly DORMANT_DAYS old — still active
      row({ customer: "Edge", pickupDate: "2026-05-30" }),
      // one day past — dormant
      row({ customer: "Lapsed", pickupDate: "2026-05-29" }),
    ]);

    expect(book.active.map((c) => c.customer).sort()).toEqual(["Edge", "Fresh"]);
    expect(book.dormant.map((c) => c.customer)).toEqual(["Lapsed"]);
    expect(book.dormantDays).toBe(DORMANT_DAYS);
    expect(book.active.find((c) => c.customer === "Edge")!.daysSinceLastLoad).toBe(60);
  });

  it("honours a caller-supplied dormancy window", () => {
    const rows = [row({ customer: "Lapsed", pickupDate: "2026-06-20" })]; // 39 days
    expect(build(rows).active).toHaveLength(1);
    expect(build(rows, { dormantDays: 30 }).dormant).toHaveLength(1);
  });

  it("judges dormancy on the MOST RECENT load, not the first", () => {
    const book = build([
      row({ customer: "Acme", pickupDate: "2024-01-01" }),
      row({ customer: "Acme", pickupDate: "2026-07-20" }),
    ]);
    expect(book.active).toHaveLength(1);
    expect(book.active[0].lastLoadDate).toBe("2026-07-20");
    expect(book.active[0].lifetime.loads).toBe(2);
  });

  it("treats a future-dated pickup as active with 0 days since", () => {
    // Countable loads with future pickup dates genuinely exist in the book.
    const book = build([row({ customer: "Ahead", pickupDate: "2026-08-21" })]);
    expect(book.active[0].daysSinceLastLoad).toBe(0);
    expect(book.active[0].status).toBe("active");
  });
});

describe("status is independent of the selected range", () => {
  it("keeps an active customer visible with zero loads in a narrow range", () => {
    // The whole point of the 1:1: "you have an active account that didn't run
    // last week." A range-derived status would have hidden this customer.
    const book = build([row({ customer: "Quiet", pickupDate: "2026-06-25" })], {
      rangeFrom: "2026-07-20",
      rangeToExclusive: "2026-07-27",
    });

    expect(book.active).toHaveLength(1);
    expect(book.active[0].period.loads).toBe(0);
    expect(book.active[0].lifetime.loads).toBe(1);
    expect(book.periodTotals.loads).toBe(0);
  });

  it("keeps a dormant customer's lifetime totals even when the range is empty", () => {
    const book = build([
      row({ customer: "Gone", pickupDate: "2025-01-10", revenue: 5000, carrierCost: 4000 }),
    ]);
    expect(book.dormant[0].lifetime.margin).toBe(1000);
    expect(book.dormant[0].period.loads).toBe(0);
  });
});

describe("range filtering", () => {
  it("includes the lower bound and excludes the upper bound", () => {
    const book = build([
      row({ customer: "Acme", pickupDate: "2026-06-30" }), // before
      row({ customer: "Acme", pickupDate: "2026-07-01" }), // first day, in
      row({ customer: "Acme", pickupDate: "2026-07-31" }), // last day, in
      row({ customer: "Acme", pickupDate: "2026-08-01" }), // exclusive bound, out
    ]);
    expect(book.active[0].period.loads).toBe(2);
    expect(book.active[0].lifetime.loads).toBe(4);
  });
});

describe("margin", () => {
  it("nets the lumper pass-through out of margin and revenue", () => {
    // $1,500 sell / $1,000 buy with a $200 lumper reimbursed on the sell side:
    // real margin is $300, not $500.
    const book = build([
      row({ revenue: 1500, carrierCost: 1000, lumperRevenue: 200, lumperCost: 0 }),
    ]);
    expect(book.active[0].period.margin).toBe(300);
    expect(book.active[0].period.revenue).toBe(1300);
  });

  it("is a no-op when the lumper legs match (transit leg)", () => {
    const book = build([
      row({ revenue: 1500, carrierCost: 1000, lumperRevenue: 200, lumperCost: 200 }),
    ]);
    expect(book.active[0].period.margin).toBe(500);
  });
});

describe("ordering", () => {
  it("ranks active customers by period margin, then lifetime", () => {
    const book = build([
      row({ customer: "Small", revenue: 1100, carrierCost: 1000 }),
      row({ customer: "Big", revenue: 5000, carrierCost: 1000 }),
      // no loads in range, but the largest history — must not outrank earners
      row({ customer: "Historic", pickupDate: "2026-06-10", revenue: 90000, carrierCost: 1000 }),
    ]);
    expect(book.active.map((c) => c.customer)).toEqual(["Big", "Small", "Historic"]);
  });

  it("ranks dormant customers most-recently-lapsed first", () => {
    const book = build([
      row({ customer: "LongGone", pickupDate: "2024-02-01", revenue: 99999, carrierCost: 0 }),
      row({ customer: "JustLapsed", pickupDate: "2026-05-20" }),
      row({ customer: "Middle", pickupDate: "2026-01-15" }),
    ]);
    // The winnable one leads, even though LongGone earned far more.
    expect(book.dormant.map((c) => c.customer)).toEqual(["JustLapsed", "Middle", "LongGone"]);
  });
});

describe("hygiene", () => {
  it("trims whitespace-twin customer names into one entry", () => {
    const book = build([row({ customer: "Acme" }), row({ customer: " Acme " })]);
    expect(book.active).toHaveLength(1);
    expect(book.active[0].lifetime.loads).toBe(2);
  });

  it("drops rows with no customer name", () => {
    const book = build([row({ customer: "" }), row({ customer: "   " }), row()]);
    expect(book.active).toHaveLength(1);
    expect(book.active[0].customer).toBe("Acme");
  });

  it("totals the period across every customer, active and dormant alike", () => {
    const book = build([
      row({ customer: "A", revenue: 1000, carrierCost: 600 }),
      row({ customer: "B", revenue: 2000, carrierCost: 1500 }),
      row({ customer: "Old", pickupDate: "2025-01-01", revenue: 9000, carrierCost: 0 }),
    ]);
    expect(book.periodTotals).toEqual({ loads: 2, revenue: 3000, margin: 900 });
  });

  it("returns empty structures for an empty book", () => {
    const book = build([]);
    expect(book.active).toEqual([]);
    expect(book.dormant).toEqual([]);
    expect(book.periodTotals).toEqual({ loads: 0, revenue: 0, margin: 0 });
  });
});

describe("brokerSegmentOf (the proxy's own-page guard)", () => {
  it("resolves the broker page and every child route to the same name", () => {
    expect(brokerSegmentOf("/broker/Tom%20Licata")).toBe("Tom Licata");
    // The regression: a child route must still resolve to just the broker.
    expect(brokerSegmentOf("/broker/Tom%20Licata/customer/Acme%20Corp")).toBe("Tom Licata");
    expect(brokerSegmentOf("/broker/Tom%20Licata/")).toBe("Tom Licata");
  });

  it("handles names with slashes-adjacent punctuation and encoded characters", () => {
    expect(brokerSegmentOf("/broker/O%27Brien%2C%20Pat")).toBe("O'Brien, Pat");
  });

  it("returns empty for non-broker paths", () => {
    expect(brokerSegmentOf("/leaderboard")).toBe("");
    expect(brokerSegmentOf("/broker")).toBe("");
  });

  it("never throws on a malformed escape", () => {
    expect(() => brokerSegmentOf("/broker/%E0%A4%A")).not.toThrow();
  });
});
