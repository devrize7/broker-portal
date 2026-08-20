import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchCountableLoadsMock = vi.hoisted(() => vi.fn());
const loadsForBrokerMock = vi.hoisted(() => vi.fn());
const requireBrokerAccessMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/load-query", async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    fetchCountableLoads: fetchCountableLoadsMock,
    loadsForBroker: loadsForBrokerMock,
  };
});
vi.mock("@/lib/route-auth", () => ({ requireBrokerAccess: requireBrokerAccessMock }));
vi.mock("@/lib/roster", () => ({ getRoster: async () => ({}) }));
vi.mock("@/lib/db", () => ({ db: { execute: executeMock } }));

import { GET } from "@/app/api/broker/customer-report/route";

function req(qs: string) {
  return { nextUrl: { searchParams: new URLSearchParams(qs) } } as any;
}

beforeEach(() => {
  fetchCountableLoadsMock.mockReset().mockResolvedValue([]);
  loadsForBrokerMock.mockReset().mockReturnValue([
    {
      loadNumber: "1", customer: "Acme", salesRep: "Rep", pickupYmd: "2026-08-10",
      origin: "Dallas, TX", destination: "Atlanta, GA", carrier: "Acme Trucking",
      status: "delivered", revenue: 2000, carrierCost: 1500, lumperRevenue: 0, lumperCost: 0,
      weekKey: "2026-08-10",
    },
  ]);
  requireBrokerAccessMock.mockReset().mockResolvedValue({ ok: true, broker: "Grant Morse", response: null });
  executeMock.mockReset().mockResolvedValue({ rows: [] });
});

describe("GET /api/broker/customer-report", () => {
  it("asks for incomplete-financials loads — the customer's shipping record must not be short", async () => {
    // This report shows NO margin. Every other surface drops loads whose sell
    // or buy side was never keyed into TAI; this one must not, or a customer
    // reconciling it against their own records finds loads missing.
    await GET(req("broker=Grant+Morse&customer=Acme&preset=this_month"));
    expect(fetchCountableLoadsMock).toHaveBeenCalledWith({ includeIncompleteFinancials: true });
  });

  it("refuses before touching the database when broker access is denied", async () => {
    const denied = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    requireBrokerAccessMock.mockResolvedValue({ ok: false, broker: null, response: denied });
    const res = await GET(req("broker=Someone+Else&customer=Acme"));
    expect(res.status).toBe(403);
    expect(fetchCountableLoadsMock).not.toHaveBeenCalled();
  });

  it("404s a customer this broker never ran, rather than returning an empty report", async () => {
    loadsForBrokerMock.mockReturnValue([]);
    const res = await GET(req("broker=Grant+Morse&customer=Nope&preset=this_month"));
    expect(res.status).toBe(404);
  });
});
