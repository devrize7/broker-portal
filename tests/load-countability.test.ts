import { describe, expect, it } from "vitest";
import { isRealLoad } from "@/lib/load-countability";

// CROSS-REPO MIRROR of freight-dashboard tests/load-countability.test.ts.
// These cases pin the rule that keeps the portal leaderboard and the command
// center leaderboard quoting the same margin for the same broker-week.
//
// Rule 3 was added after load 130982546 — TAI `Delivered`, totalSell $2,915,
// totalBuy $0, empty carrierList — booked $2,915 of fake margin, 39% of
// Raphael Jackson's week.
describe("isRealLoad", () => {
  const load = (o: Partial<Parameters<typeof isRealLoad>[0]> = {}) => ({
    revenue: 1000,
    carrierCost: 800,
    carrier: "SOME CARRIER LLC",
    ...o,
  });

  it("counts an ordinary load with revenue and carrier cost", () => {
    expect(isRealLoad(load())).toBe(true);
  });

  it("drops a $0-REVENUE load with a booked carrier cost (fake LOSS, the mirror image)", () => {
    // 130775435 DiMare Fresh: TAI totalSell 0, totalBuy 6800, invoice exists
    // for $0.00 with zero line items. With 130592612 it dragged Raphael
    // Jackson's week of Aug 3-9 to -$8,800; his one complete load made +$750.
    expect(isRealLoad(load({ revenue: 0, carrierCost: 6800, carrier: "CHAWLA TRANSPORT INC" }))).toBe(false);
    expect(isRealLoad(load({ revenue: 0, carrierCost: 2750, carrier: "KEN-TRAN TRUCKING INC" }))).toBe(false);
  });

  it("KEEPS a genuine loss — the test is revenue EXACTLY $0, not cost > revenue", () => {
    expect(isRealLoad(load({ revenue: 3000, carrierCost: 3500 }))).toBe(true);
    expect(isRealLoad(load({ revenue: 1, carrierCost: 99999 }))).toBe(true);
  });

  it("drops the $0/$0 phantom (webhook status update, no financials)", () => {
    expect(isRealLoad(load({ revenue: 0, carrierCost: 0, carrier: null }))).toBe(false);
    expect(isRealLoad(load({ revenue: 0, carrierCost: 0 }))).toBe(false);
  });

  it("drops a NEGATIVE carrier cost (load 125030207: -$100 cost, $488.70 margin on $388.70)", () => {
    expect(isRealLoad(load({ revenue: 388.7, carrierCost: -100 }))).toBe(false);
    // Negative cost is bad data whether or not a carrier is named.
    expect(isRealLoad(load({ revenue: 388.7, carrierCost: -100, carrier: null }))).toBe(false);
  });

  it("drops revenue with $0 cost and NO carrier (the 130982546 case)", () => {
    expect(isRealLoad(load({ revenue: 2915, carrierCost: 0, carrier: null }))).toBe(false);
  });

  it("treats an empty/whitespace carrier as no carrier", () => {
    expect(isRealLoad(load({ revenue: 2915, carrierCost: 0, carrier: "" }))).toBe(false);
    expect(isRealLoad(load({ revenue: 2915, carrierCost: 0, carrier: "   " }))).toBe(false);
  });

  it("KEEPS a $0-cost load with a named carrier (accessorial re-bill — real margin)", () => {
    // Jacob, 2026-08-16: "the accessorials are fine ... it's more about the
    // linehaul". A blanket `carrierCost > 0` would delete these.
    expect(isRealLoad(load({ revenue: 250, carrierCost: 0, carrier: "MARLEEL TRANSPORT LLC" }))).toBe(true);
    expect(isRealLoad(load({ revenue: 150, carrierCost: 0, carrier: "RAMA TRUCKING INC" }))).toBe(true);
  });

  it("keeps a carrier-less load that HAS carrier cost (cost is the proof of a real haul)", () => {
    expect(isRealLoad(load({ revenue: 1000, carrierCost: 800, carrier: null }))).toBe(true);
  });

  it("self-heals: the same load counts once the buy side is keyed in", () => {
    const broken = { revenue: 2915, carrierCost: 0, carrier: null };
    expect(isRealLoad(broken)).toBe(false);
    expect(isRealLoad({ ...broken, carrierCost: 2400, carrier: "REAL CARRIER INC" })).toBe(true);
  });
});
