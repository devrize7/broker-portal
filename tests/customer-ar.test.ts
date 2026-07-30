import { describe, expect, it } from "vitest";
import {
  AR_ALERT_MIN_DAYS,
  NET_DAYS,
  buildCustomerAr,
  isSeriouslyPastDue,
  type ArLoadRow,
} from "@/lib/customer-ar";

const NOW = Date.parse("2026-07-30T12:00:00Z");
const DAY = 86_400_000;

/** An invoice dated `n` days ago. */
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

const row = (over: Partial<ArLoadRow> = {}): ArLoadRow => ({
  customer: "Acme",
  invoiceBalance: 1000,
  invoiceDate: daysAgo(10),
  pickupDate: daysAgo(14),
  dunningHold: false,
  disputedAt: null,
  ptpDate: null,
  ...over,
});

const ar = (rows: ArLoadRow[], customer = "Acme") => buildCustomerAr(rows, NOW).get(customer);

describe("open vs overdue", () => {
  it("counts an invoice as overdue only after net terms elapse", () => {
    // Invoiced exactly NET_DAYS ago → due today → not yet late.
    expect(ar([row({ invoiceDate: daysAgo(NET_DAYS) })])!.overdueTotal).toBe(0);
    // One day beyond → late.
    const late = ar([row({ invoiceDate: daysAgo(NET_DAYS + 1) })])!;
    expect(late.overdueTotal).toBe(1000);
    expect(late.oldestDaysOverdue).toBe(1);
  });

  it("always counts an open invoice toward totalOpen, late or not", () => {
    const a = ar([
      row({ invoiceBalance: 500, invoiceDate: daysAgo(1) }),
      row({ invoiceBalance: 900, invoiceDate: daysAgo(NET_DAYS + 5) }),
    ])!;
    expect(a.totalOpen).toBe(1400);
    expect(a.invoiceCount).toBe(2);
    expect(a.overdueTotal).toBe(900);
    expect(a.overdueCount).toBe(1);
  });

  it("falls back to pickupDate when invoiceDate is missing", () => {
    // The cron may not have backfilled invoiceDate from TAI yet. Without the
    // fallback this reads as daysOverdue 0 → "current" → escapes chasing.
    const a = ar([row({ invoiceDate: null, pickupDate: daysAgo(NET_DAYS + 20) })])!;
    expect(a.overdueTotal).toBe(1000);
    expect(a.oldestDaysOverdue).toBe(20);
  });

  it("treats a load with neither date as not overdue rather than infinitely late", () => {
    const a = ar([row({ invoiceDate: null, pickupDate: null })])!;
    expect(a.totalOpen).toBe(1000);
    expect(a.overdueTotal).toBe(0);
    expect(a.oldestDaysOverdue).toBe(0);
  });

  it("reports the oldest overdue load, not the newest", () => {
    const a = ar([
      row({ invoiceDate: daysAgo(NET_DAYS + 3) }),
      row({ invoiceDate: daysAgo(NET_DAYS + 41) }),
      row({ invoiceDate: daysAgo(NET_DAYS + 12) }),
    ])!;
    expect(a.oldestDaysOverdue).toBe(41);
  });
});

describe("parked money is open but never overdue", () => {
  const veryLate = { invoiceDate: daysAgo(NET_DAYS + 50) };

  it.each([
    ["on dunning hold", { dunningHold: true }],
    ["disputed", { disputedAt: daysAgo(2) }],
    ["under a future promise-to-pay", { ptpDate: new Date(NOW + 5 * DAY).toISOString() }],
  ])("excludes a load %s from overdue while keeping it in totalOpen", (_label, parked) => {
    const a = ar([row({ ...veryLate, ...parked })])!;
    expect(a.totalOpen).toBe(1000);
    expect(a.parkedTotal).toBe(1000);
    expect(a.overdueTotal).toBe(0);
    expect(a.overdueCount).toBe(0);
    // A parked load must not set the oldest-overdue clock either — otherwise
    // the row would read "60d past due" with $0 overdue.
    expect(a.oldestDaysOverdue).toBe(0);
  });

  it("counts a LAPSED promise-to-pay as overdue again", () => {
    const a = ar([row({ ...veryLate, ptpDate: new Date(NOW - DAY).toISOString() })])!;
    expect(a.overdueTotal).toBe(1000);
    expect(a.parkedTotal).toBe(0);
  });

  it("keeps parked and active money separate on the same customer", () => {
    const a = ar([
      row({ invoiceBalance: 400, ...veryLate, dunningHold: true }),
      row({ invoiceBalance: 600, ...veryLate }),
    ])!;
    expect(a.totalOpen).toBe(1000);
    expect(a.parkedTotal).toBe(400);
    expect(a.overdueTotal).toBe(600);
  });
});

describe("hygiene", () => {
  it("ignores rows with no open balance", () => {
    expect(ar([row({ invoiceBalance: 0 }), row({ invoiceBalance: -50 })])).toBeUndefined();
  });

  it("groups whitespace-twin customer names together", () => {
    const a = ar([row({ customer: "Acme" }), row({ customer: " Acme " })])!;
    expect(a.invoiceCount).toBe(2);
  });

  it("keeps customers separate", () => {
    const map = buildCustomerAr([row({ customer: "A" }), row({ customer: "B" })], NOW);
    expect(map.get("A")!.totalOpen).toBe(1000);
    expect(map.get("B")!.totalOpen).toBe(1000);
  });
});

describe("isSeriouslyPastDue", () => {
  it("fires only on real overdue money aged past the alert threshold", () => {
    expect(isSeriouslyPastDue(undefined)).toBe(false);
    // Late, but not late enough.
    expect(
      isSeriouslyPastDue(ar([row({ invoiceDate: daysAgo(NET_DAYS + AR_ALERT_MIN_DAYS - 1) })]))
    ).toBe(false);
    expect(
      isSeriouslyPastDue(ar([row({ invoiceDate: daysAgo(NET_DAYS + AR_ALERT_MIN_DAYS) })]))
    ).toBe(true);
  });

  it("does not fire on a big balance that is merely not yet due", () => {
    expect(isSeriouslyPastDue(ar([row({ invoiceBalance: 90_000, invoiceDate: daysAgo(1) })]))).toBe(
      false
    );
  });

  it("does not fire when the whole balance is parked", () => {
    expect(
      isSeriouslyPastDue(
        ar([row({ invoiceDate: daysAgo(NET_DAYS + 90), dunningHold: true })])
      )
    ).toBe(false);
  });
});
