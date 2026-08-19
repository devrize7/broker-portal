import { describe, expect, it, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => executeMock(...a) } }));

import { fetchCountableLoads } from "@/lib/load-query";

/** One raw Load row as the driver returns it. */
function row(over: Record<string, unknown> = {}) {
  return {
    loadNumber: "1", customer: "Acme", salesRep: "Rep",
    pickupDate: "2026-08-10T12:00:00Z", origin: "Dallas, TX", destination: "Atlanta, GA",
    carrier: "Acme Trucking", status: "delivered",
    revenue: 2000, carrierCost: 1500, lumperRevenue: 0, lumperCost: 0, profWeek: null,
    ...over,
  };
}

beforeEach(() => executeMock.mockReset());

describe("fetchCountableLoads countability", () => {
  it("keeps a load with both sides booked", async () => {
    executeMock.mockResolvedValue({ rows: [row()] });
    expect(await fetchCountableLoads()).toHaveLength(1);
  });

  it("drops a load that was never billed — a fake loss, not a $0 result", async () => {
    executeMock.mockResolvedValue({ rows: [row({ revenue: 0, carrierCost: 6800 })] });
    expect(await fetchCountableLoads()).toHaveLength(0);
  });

  it("drops a delivered load with no carrier booked — a fake profit", async () => {
    executeMock.mockResolvedValue({ rows: [row({ carrierCost: 0, carrier: null })] });
    expect(await fetchCountableLoads()).toHaveLength(0);
  });

  it("does NOT test the defaulted carrier — a null carrier must not pass as \"Unknown\"", async () => {
    // The mapping defaults a null carrier to "Unknown", which is truthy. If the
    // rule were applied after that default it would never fire, and every
    // no-carrier load would silently keep booking fake margin.
    executeMock.mockResolvedValue({ rows: [row({ carrierCost: 0, carrier: "" })] });
    expect(await fetchCountableLoads()).toHaveLength(0);
  });

  it("keeps a $0-cost load that HAS a named carrier — accessorial re-bills are real margin", async () => {
    // Deliberately narrower than a blanket carrierCost > 0. Over-excluding real
    // margin is the harder error to notice. There are no free linehaul moves,
    // but a detention re-bill against a named carrier is genuinely ours.
    executeMock.mockResolvedValue({ rows: [row({ carrierCost: 0, carrier: "Acme Trucking" })] });
    expect(await fetchCountableLoads()).toHaveLength(1);
  });

  it("drops a negative carrier cost, which inflates margin harder than a missing one", async () => {
    executeMock.mockResolvedValue({ rows: [row({ carrierCost: -100, revenue: 388.7 })] });
    expect(await fetchCountableLoads()).toHaveLength(0);
  });

  it("re-admits a load the moment the missing side is keyed in, with no backfill", async () => {
    executeMock.mockResolvedValue({ rows: [row({ carrierCost: 0, carrier: null })] });
    expect(await fetchCountableLoads()).toHaveLength(0);
    executeMock.mockResolvedValue({ rows: [row({ carrierCost: 1500, carrier: "Acme Trucking" })] });
    expect(await fetchCountableLoads()).toHaveLength(1);
  });

  describe("includeIncompleteFinancials — the no-margin client report only", () => {
    it("keeps incomplete loads so a customer's shipping record is not short", async () => {
      executeMock.mockResolvedValue({
        rows: [row({ revenue: 0, carrierCost: 6800 }), row({ loadNumber: "2", carrierCost: 0, carrier: null })],
      });
      expect(await fetchCountableLoads({ includeIncompleteFinancials: true })).toHaveLength(2);
    });

    it("still drops a $0/$0 record, which carries no signal even for that caller", async () => {
      executeMock.mockResolvedValue({ rows: [row({ revenue: 0, carrierCost: 0, carrier: null })] });
      expect(await fetchCountableLoads({ includeIncompleteFinancials: true })).toHaveLength(0);
    });
  });
});
