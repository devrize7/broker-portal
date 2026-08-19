import { describe, expect, it } from "vitest";
import { netLumper, trueMargin, trueRevenue } from "@/lib/margin";

describe("netLumper", () => {
  it("is zero when the lumper was billed and paid at the same figure", () => {
    // The transit-leg shape: buy == sell, so the lumper never touches margin.
    expect(netLumper(370, 370)).toBe(0);
  });

  it("is the full billed amount when the payment landed buy=$0", () => {
    // The Easy Foods shape — this is the fake profit the rule exists to remove.
    expect(netLumper(428, 0)).toBe(428);
  });

  it("treats missing columns as zero rather than NaN", () => {
    expect(netLumper(null, undefined)).toBe(0);
    expect(netLumper(undefined, null)).toBe(0);
  });
});

describe("trueMargin", () => {
  it("removes a lumper that was billed but never paid out", () => {
    // Load 130209854: rev 1328, cost 1000, lr 428, lc 0. Naive margin reads
    // $328; the real margin is $-100 once the reimbursement comes out.
    expect(trueMargin(1328, 1000, 428, 0)).toBe(-100);
  });

  it("is a no-op when the lumper cost is already inside carrierCost", () => {
    // Load 130351452: the $370 sits on both sides, so margin is just rev-cost.
    expect(trueMargin(4020, 3470, 370, 370)).toBe(550);
  });

  it("equals plain revenue minus cost when no lumper is present", () => {
    expect(trueMargin(2000, 1500, 0, 0)).toBe(500);
  });
});

describe("trueRevenue", () => {
  it("strips the reimbursement so margin % has an honest base", () => {
    expect(trueRevenue(1328, 428)).toBe(900);
  });

  it("stays consistent with trueMargin", () => {
    // trueMargin must equal trueRevenue minus the non-lumper carrier spend,
    // or the margin % printed on the leaderboard is computed off two different
    // definitions of revenue.
    const [rev, cost, lr, lc] = [4512.97, 4775.78, 230.78, 225.78];
    expect(trueMargin(rev, cost, lr, lc)).toBeCloseTo(trueRevenue(rev, lr) - (cost - lc), 10);
  });
});
