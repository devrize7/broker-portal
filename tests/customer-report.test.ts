import { describe, expect, it } from "vitest";
import { buildCustomerReport, type ReportLoad } from "@/lib/customer-report";

function load(over: Partial<ReportLoad> = {}): ReportLoad {
  return {
    loadNumber: "1",
    pickupYmd: "2026-08-03",
    origin: "Dallas, TX",
    destination: "Atlanta, GA",
    carrier: "Acme Trucking",
    status: "delivered",
    revenue: 2000,
    miles: 780,
    deliveryDate: "2026-08-05T12:00:00Z",
    deliveryApptClose: null,
    deliveryActualArrival: null,
    ...over,
  };
}

describe("buildCustomerReport", () => {
  it("totals revenue and loads, and averages per load", () => {
    const r = buildCustomerReport(
      [load({ loadNumber: "1", revenue: 1000 }), load({ loadNumber: "2", revenue: 3000 })],
      0,
      0
    );
    expect(r.stats.totalRevenue).toBe(4000);
    expect(r.stats.totalLoads).toBe(2);
    expect(r.stats.avgRevPerLoad).toBe(2000);
  });

  it("is empty-safe and does not divide by zero", () => {
    const r = buildCustomerReport([], 0, 0);
    expect(r.stats.totalLoads).toBe(0);
    expect(r.stats.avgRevPerLoad).toBe(0);
    expect(r.stats.claimsPct).toBeNull();
    expect(r.firstLoadDate).toBeNull();
    expect(r.weekly).toEqual([]);
    expect(r.topLanes).toEqual([]);
  });

  it("reports claims as unknown, never as zero, when the lookup failed", () => {
    // "0 claims" on a customer-facing document is a clean-record assurance.
    // We only make it when we actually read the table.
    const r = buildCustomerReport([load()], 0, null);
    expect(r.stats.claimsCount).toBeNull();
    expect(r.stats.claimsPct).toBeNull();
  });

  it("still reports a real zero when the lookup succeeded and found none", () => {
    const r = buildCustomerReport([load()], 0, 0);
    expect(r.stats.claimsCount).toBe(0);
    expect(r.stats.claimsPct).toBe(0);
  });

  it("reports 0% acceptance with nothing tendered rather than a perfect record", () => {
    // 100% here would claim a spotless record that was never tested.
    expect(buildCustomerReport([], 0, 0).stats.acceptancePct).toBe(0);
  });

  it("counts cancelled loads against acceptance without letting them into revenue", () => {
    const r = buildCustomerReport([load({ revenue: 1000 })], 3, 0);
    expect(r.stats.totalRevenue).toBe(1000);
    expect(r.stats.totalLoads).toBe(1);
    expect(r.stats.cancelledCount).toBe(3);
    expect(r.stats.acceptancePct).toBe(25); // 1 of 4 tendered survived
  });

  it("buckets weekly revenue by the Monday of the pickup week", () => {
    const r = buildCustomerReport(
      [
        load({ loadNumber: "1", pickupYmd: "2026-08-03", revenue: 500 }), // Mon
        load({ loadNumber: "2", pickupYmd: "2026-08-07", revenue: 700 }), // Fri, same week
        load({ loadNumber: "3", pickupYmd: "2026-08-10", revenue: 900 }), // next Mon
      ],
      0,
      0
    );
    expect(r.weekly).toEqual([
      { weekStart: "2026-08-03", revenue: 1200, loads: 2 },
      { weekStart: "2026-08-10", revenue: 900, loads: 1 },
    ]);
  });

  it("ranks lanes by volume and skips Unknown endpoints", () => {
    const r = buildCustomerReport(
      [
        load({ loadNumber: "1", origin: "Dallas, TX", destination: "Atlanta, GA" }),
        load({ loadNumber: "2", origin: "Dallas, TX", destination: "Atlanta, GA" }),
        load({ loadNumber: "3", origin: "Reno, NV", destination: "Boise, ID" }),
        load({ loadNumber: "4", origin: "Unknown", destination: "Boise, ID" }),
      ],
      0,
      0
    );
    expect(r.topLanes.map((l) => l.lane)).toEqual([
      "Dallas, TX → Atlanta, GA",
      "Reno, NV → Boise, ID",
    ]);
    expect(r.topLanes[0].loads).toBe(2);
  });

  it("counts each state once across origins and destinations", () => {
    const r = buildCustomerReport(
      [
        load({ loadNumber: "1", origin: "Dallas, TX", destination: "Atlanta, GA" }),
        load({ loadNumber: "2", origin: "Austin, TX", destination: "Macon, GA" }),
      ],
      0,
      0
    );
    expect(r.network.statesCovered).toBe(2);
  });

  it("does not count Unknown as a carrier partner or a state", () => {
    const r = buildCustomerReport(
      [load({ carrier: "Unknown", origin: "Unknown", destination: "Unknown" })],
      0,
      0
    );
    expect(r.network.carrierPartners).toBe(0);
    expect(r.network.statesCovered).toBe(0);
  });

  it("carries the on-time summary through without inventing coverage", () => {
    const r = buildCustomerReport(
      [
        load({
          loadNumber: "1",
          deliveryApptClose: "2026-08-05T17:00:00Z",
          deliveryActualArrival: "2026-08-05T16:00:00Z",
        }),
        load({ loadNumber: "2", deliveryApptClose: null, deliveryActualArrival: "2026-08-05T16:00:00Z" }),
      ],
      0,
      0
    );
    expect(r.stats.onTime.onTimePct).toBe(100);
    expect(r.stats.onTime.measured).toBe(1);
    expect(r.stats.onTime.coveragePct).toBe(50);
  });

  it("ignores negative transit times rather than averaging in bad data", () => {
    const r = buildCustomerReport(
      [
        load({ loadNumber: "1", pickupYmd: "2026-08-03", deliveryDate: "2026-08-05T12:00:00Z" }),
        // Delivery stamped before pickup — bad data, not a same-day miracle.
        load({ loadNumber: "2", pickupYmd: "2026-08-10", deliveryDate: "2026-08-01T12:00:00Z" }),
      ],
      0,
      0
    );
    expect(r.network.avgTransitDays).toBe(2);
  });

  it("reports the first and last load dates in range", () => {
    const r = buildCustomerReport(
      [
        load({ loadNumber: "1", pickupYmd: "2026-09-01" }),
        load({ loadNumber: "2", pickupYmd: "2026-08-03" }),
        load({ loadNumber: "3", pickupYmd: "2026-08-20" }),
      ],
      0,
      0
    );
    expect(r.firstLoadDate).toBe("2026-08-03");
    expect(r.lastLoadDate).toBe("2026-09-01");
  });

  it("exposes no margin, cost, or commission anywhere in the report", () => {
    // The client report is handed to the customer. This asserts the promise
    // structurally rather than trusting a future edit to remember it.
    const r = buildCustomerReport([load()], 0, 0);
    const serialized = JSON.stringify(r).toLowerCase();
    expect(serialized).not.toContain("margin");
    expect(serialized).not.toContain("carriercost");
    expect(serialized).not.toContain("commission");
    expect(serialized).not.toContain("profit");
  });
});
