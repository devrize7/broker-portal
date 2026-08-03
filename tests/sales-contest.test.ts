import { describe, it, expect } from "vitest";
import {
  CONTEST_START,
  CONTEST_END,
  CONTEST_MIDPOINT,
  inContestWindow,
  midpointLeader,
  midpointLoads,
  midpointReached,
  mostNewCustomers,
  rankBrokers,
  topNewCustomer,
  type ContestLoad,
} from "@/lib/sales-contest";

function load(over: Partial<ContestLoad> = {}): ContestLoad {
  return {
    broker: "Tom Licata",
    customer: "Acme Foods",
    gp: 100,
    revenue: 1000,
    pickupYmd: "2026-08-10",
    ...over,
  };
}

describe("contest window", () => {
  it("runs Aug 3 through Dec 18 inclusive", () => {
    expect(CONTEST_START).toBe("2026-08-03");
    expect(CONTEST_END).toBe("2026-12-18");
    expect(inContestWindow("2026-08-03")).toBe(true);
    expect(inContestWindow("2026-12-18")).toBe(true);
  });

  it("excludes the days on either side of the bell", () => {
    // The previous contest kept accruing after its end date (portal #13).
    expect(inContestWindow("2026-08-02")).toBe(false);
    expect(inContestWindow("2026-12-19")).toBe(false);
  });
});

describe("rankBrokers", () => {
  it("ranks by total gross margin, descending", () => {
    const rows = rankBrokers([
      load({ broker: "Tom Licata", customer: "Acme", gp: 100 }),
      load({ broker: "Grant Morse", customer: "Beta", gp: 500 }),
      load({ broker: "Ivan Moya", customer: "Gamma", gp: 250 }),
    ]);
    expect(rows.map((r) => r.broker)).toEqual(["Grant Morse", "Ivan Moya", "Tom Licata"]);
  });

  it("aggregates loads per customer and tracks the first pickup", () => {
    const rows = rankBrokers([
      load({ customer: "Acme", gp: 100, revenue: 1000, pickupYmd: "2026-09-01" }),
      load({ customer: "Acme", gp: 150, revenue: 1200, pickupYmd: "2026-08-14" }),
      load({ customer: "Beta", gp: 75, revenue: 900, pickupYmd: "2026-08-20" }),
    ]);
    expect(rows).toHaveLength(1);
    const [tom] = rows;
    expect(tom.totalGP).toBe(325);
    expect(tom.totalRevenue).toBe(3100);
    expect(tom.totalLoads).toBe(3);
    expect(tom.newCustomerCount).toBe(2);

    const acme = tom.customers.find((c) => c.customer === "Acme")!;
    expect(acme.loads).toBe(2);
    expect(acme.gp).toBe(250);
    expect(acme.firstPickup).toBe("2026-08-14");
  });

  it("sorts a broker's own customers by margin", () => {
    const [tom] = rankBrokers([
      load({ customer: "Small", gp: 50 }),
      load({ customer: "Big", gp: 900 }),
      load({ customer: "Mid", gp: 300 }),
    ]);
    expect(tom.customers.map((c) => c.customer)).toEqual(["Big", "Mid", "Small"]);
  });

  it("lists active brokers with no new customers as real zeros", () => {
    const rows = rankBrokers([load({ broker: "Tom Licata", gp: 100 })], [
      "Tom Licata",
      "Reggie Pena",
    ]);
    const reggie = rows.find((r) => r.broker === "Reggie Pena")!;
    expect(reggie.totalGP).toBe(0);
    expect(reggie.newCustomerCount).toBe(0);
    expect(reggie.customers).toEqual([]);
    // Producers stay on top.
    expect(rows[0].broker).toBe("Tom Licata");
  });

  it("does not duplicate a broker who is both scoring and on the roster", () => {
    const rows = rankBrokers([load({ broker: "Tom Licata" })], ["Tom Licata"]);
    expect(rows.filter((r) => r.broker === "Tom Licata")).toHaveLength(1);
  });

  it("rounds money to cents rather than carrying float dust", () => {
    const [tom] = rankBrokers([
      load({ customer: "Acme", gp: 0.1, revenue: 0.1 }),
      load({ customer: "Acme", gp: 0.2, revenue: 0.2 }),
    ]);
    expect(tom.totalGP).toBe(0.3);
    expect(tom.customers[0].gp).toBe(0.3);
  });
});

describe("most new customers award", () => {
  it("names the broker who landed the most accounts", () => {
    const standings = rankBrokers([
      load({ broker: "Tom Licata", customer: "A" }),
      load({ broker: "Tom Licata", customer: "B" }),
      load({ broker: "Grant Morse", customer: "C", gp: 9999 }),
    ]);
    // Grant leads on margin; the YETI goes on account COUNT.
    expect(standings[0].broker).toBe("Grant Morse");
    expect(mostNewCustomers(standings)).toEqual({ brokers: ["Tom Licata"], count: 2 });
  });

  it("names every broker in a tie", () => {
    const standings = rankBrokers([
      load({ broker: "Tom Licata", customer: "A" }),
      load({ broker: "Grant Morse", customer: "B" }),
    ]);
    expect(mostNewCustomers(standings)!.brokers.sort()).toEqual(["Grant Morse", "Tom Licata"]);
  });

  it("declares no leader over a field of zeros", () => {
    const standings = rankBrokers([], ["Tom Licata", "Grant Morse"]);
    expect(mostNewCustomers(standings)).toBeNull();
  });
});

describe("highest margin new customer award", () => {
  it("picks the single best account, not the best broker", () => {
    const standings = rankBrokers([
      load({ broker: "Tom Licata", customer: "A", gp: 400 }),
      load({ broker: "Tom Licata", customer: "B", gp: 400 }),
      load({ broker: "Grant Morse", customer: "C", gp: 600 }),
    ]);
    // Tom leads overall on $800; the gear goes to Grant's single $600 account.
    expect(standings[0].broker).toBe("Tom Licata");
    expect(topNewCustomer(standings)).toEqual({
      entries: [{ broker: "Grant Morse", customer: "C" }],
      gp: 600,
    });
  });

  it("names every tied account", () => {
    const standings = rankBrokers([
      load({ broker: "Tom Licata", customer: "A", gp: 500 }),
      load({ broker: "Grant Morse", customer: "B", gp: 500 }),
    ]);
    expect(topNewCustomer(standings)!.entries).toHaveLength(2);
  });

  it("has no winner when every account is underwater", () => {
    const standings = rankBrokers([load({ customer: "A", gp: -200 })]);
    expect(topNewCustomer(standings)).toBeNull();
  });
});

describe("midpoint leader award", () => {
  it("counts only loads picked up on or before the midpoint", () => {
    const loads = [
      load({ pickupYmd: CONTEST_MIDPOINT }),
      load({ pickupYmd: "2026-10-12" }),
    ];
    expect(midpointLoads(loads)).toHaveLength(1);
    expect(midpointLoads(loads)[0].pickupYmd).toBe(CONTEST_MIDPOINT);
  });

  it("crowns whoever led at the halfway mark, not who leads now", () => {
    const loads = [
      load({ broker: "Tom Licata", customer: "A", gp: 300, pickupYmd: "2026-09-01" }),
      // Grant's late surge wins the overall race but not the midpoint prize.
      load({ broker: "Grant Morse", customer: "B", gp: 5000, pickupYmd: "2026-11-01" }),
    ];
    expect(rankBrokers(loads)[0].broker).toBe("Grant Morse");
    expect(midpointLeader(loads)).toEqual({ brokers: ["Tom Licata"], gp: 300 });
  });

  it("is withheld until the midpoint has actually passed", () => {
    expect(midpointReached("2026-08-03")).toBe(false);
    expect(midpointReached(CONTEST_MIDPOINT)).toBe(false);
    expect(midpointReached("2026-10-12")).toBe(true);
  });

  it("has no leader when nobody scored before the midpoint", () => {
    expect(midpointLeader([load({ gp: 900, pickupYmd: "2026-11-20" })])).toBeNull();
  });
});
